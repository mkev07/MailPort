use hickory_resolver::{
    config::ResolverOpts,
    proto::rr::{Name, RData, RecordType},
    TokioResolver,
};
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    host: String,
    port: u16,
    security: &'static str,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    incoming: Option<Endpoint>,
    outgoing: Option<Endpoint>,
    provider: Option<&'static str>,
}

fn valid_domain(value: &str) -> bool {
    value.len() <= 253
        && value.contains('.')
        && value
            .rsplit('.')
            .next()
            .is_some_and(|label| label.bytes().any(|byte| byte.is_ascii_alphabetic()))
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

fn preset(domain: &str) -> Option<Discovery> {
    let (incoming, outgoing, port, security, provider) = match domain {
        "gmail.com" | "googlemail.com" => (
            "imap.gmail.com",
            "smtp.gmail.com",
            465,
            "tls",
            Some("google"),
        ),
        "outlook.com" | "hotmail.com" | "live.com" => (
            "outlook.office365.com",
            "smtp-mail.outlook.com",
            587,
            "starttls",
            Some("microsoft"),
        ),
        "google-workspace" => (
            "imap.gmail.com",
            "smtp.gmail.com",
            465,
            "tls",
            Some("google"),
        ),
        "microsoft-365" => (
            "outlook.office365.com",
            "smtp.office365.com",
            587,
            "starttls",
            Some("microsoft"),
        ),
        "fastmail.com" | "fastmail.fm" => {
            ("imap.fastmail.com", "smtp.fastmail.com", 465, "tls", None)
        }
        "icloud.com" | "me.com" | "mac.com" => (
            "imap.mail.me.com",
            "smtp.mail.me.com",
            587,
            "starttls",
            None,
        ),
        _ => return None,
    };
    Some(Discovery {
        incoming: Some(Endpoint {
            host: incoming.into(),
            port: 993,
            security: "tls",
        }),
        outgoing: Some(Endpoint {
            host: outgoing.into(),
            port,
            security,
        }),
        provider,
    })
}

async fn lookup(
    resolver: &TokioResolver,
    service: &str,
    domain: &str,
    security: &'static str,
) -> Option<Endpoint> {
    let records = resolver
        .srv_lookup(format!("{service}._tcp.{domain}."))
        .await
        .ok()?;
    records
        .answers()
        .iter()
        .filter_map(|record| {
            let RData::SRV(record) = &record.data else {
                return None;
            };
            let target = record.target.to_ascii();
            let host = target.trim_end_matches('.');
            (record.port > 0 && valid_domain(host)).then(|| {
                (
                    record.priority,
                    record.weight,
                    Endpoint {
                        host: host.to_owned(),
                        port: record.port,
                        security,
                    },
                )
            })
        })
        .min_by_key(|(priority, weight, endpoint)| {
            (*priority, std::cmp::Reverse(*weight), endpoint.host.clone())
        })
        .map(|(_, _, endpoint)| endpoint)
}

fn mxroute_host<'a>(records: impl IntoIterator<Item = (u16, &'a str)>) -> Option<String> {
    let records: Vec<_> = records.into_iter().collect();
    let priority = records.iter().map(|(priority, _)| *priority).min()?;
    let mut hosts = records
        .iter()
        .filter(|(p, _)| *p == priority)
        .map(|(_, target)| {
            let host = target.trim_end_matches('.').to_ascii_lowercase();
            let server = host.strip_suffix(".mxrouting.net")?;
            (valid_domain(&host) && !server.contains('.') && !server.ends_with("-relay"))
                .then_some(host)
        });
    let first = hosts.next()??;
    // Equal-priority records must agree before we infer a client endpoint.
    hosts
        .all(|host| host.as_deref() == Some(first.as_str()))
        .then_some(first)
}

fn hosted_settings(records: &[(u16, String)]) -> Option<Discovery> {
    let priority = records.iter().map(|(priority, _)| *priority).min()?;
    let primary = records.iter().filter(|(p, _)| *p == priority);
    let provider_for_host = |target: &str| {
        let host = target.trim_end_matches('.').to_ascii_lowercase();
        if host == "smtp.google.com"
            || host.ends_with(".aspmx.l.google.com")
            || host == "aspmx.l.google.com"
            || host.ends_with(".aspmx.l.googlemail.com")
        {
            Some("google-workspace")
        } else if host.ends_with(".mail.protection.outlook.com") {
            Some("microsoft-365")
        } else if matches!(
            host.as_str(),
            "in1-smtp.messagingengine.com" | "in2-smtp.messagingengine.com"
        ) {
            Some("fastmail.com")
        } else if matches!(
            host.as_str(),
            "mx01.mail.icloud.com" | "mx02.mail.icloud.com"
        ) {
            Some("icloud.com")
        } else {
            None
        }
    };
    let mut providers = primary.map(|(_, host)| provider_for_host(host));
    if let Some(Some(provider)) = providers.next() {
        if providers.all(|other| other == Some(provider)) {
            return preset(provider);
        }
    }

    let host = mxroute_host(
        records
            .iter()
            .map(|(priority, host)| (*priority, host.as_str())),
    )?;
    Some(Discovery {
        incoming: Some(Endpoint {
            host: host.clone(),
            port: 993,
            security: "tls",
        }),
        outgoing: Some(Endpoint {
            host,
            port: 465,
            security: "tls",
        }),
        provider: None,
    })
}

async fn lookup_mx(resolver: &TokioResolver, domain: &str) -> Option<Discovery> {
    let records = resolver.mx_lookup(format!("{domain}.")).await.ok()?;
    let targets: Vec<_> = records
        .answers()
        .iter()
        .filter_map(|record| match &record.data {
            RData::MX(record) => Some((record.preference, record.exchange.to_ascii())),
            _ => None,
        })
        .collect();
    hosted_settings(&targets)
}

async fn mail_alias(resolver: &TokioResolver, domain: &str, expected: &str) -> Option<String> {
    let alias = format!("mail.{domain}");
    let owner = Name::from_ascii(format!("{alias}.")).ok()?;
    let target = Name::from_ascii(format!("{expected}.")).ok()?;
    if let Ok(records) = resolver.lookup(owner.clone(), RecordType::CNAME).await {
        let mut aliases = records.answers().iter().filter_map(|record| {
            let RData::CNAME(name) = &record.data else {
                return None;
            };
            (record.name == owner).then_some(&name.0)
        });
        if let Some(actual) = aliases.next() {
            return (*actual == target && aliases.next().is_none()).then_some(alias);
        }
    }

    // DNS providers can flatten an alias to address records.
    let (alias_ips, target_ips) =
        tokio::join!(resolver.lookup_ip(owner), resolver.lookup_ip(target),);
    let alias_ips = alias_ips.ok()?;
    let target_ips = target_ips.ok()?;
    let mut addresses = alias_ips.iter().peekable();
    let matches = addresses.peek().is_some()
        && addresses.all(|ip| target_ips.iter().any(|target| target == ip));
    matches.then_some(alias)
}

async fn alias_tls_valid(
    connector: &tokio_native_tls::TlsConnector,
    alias: &str,
    target: &str,
    port: u16,
) -> bool {
    // Verify the certificate for the alias against the already inferred mail host.
    // Discovery never sends login data.
    let handshake = async {
        let stream = tokio::net::TcpStream::connect((target, port)).await.ok()?;
        connector.connect(alias, stream).await.ok()
    };
    tokio::time::timeout(Duration::from_secs(2), handshake)
        .await
        .is_ok_and(|result| result.is_some())
}

async fn prefer_mxroute_alias(
    resolver: &TokioResolver,
    domain: &str,
    mut inferred: Discovery,
) -> Discovery {
    let (Some(incoming), Some(outgoing)) = (&mut inferred.incoming, &mut inferred.outgoing) else {
        return inferred;
    };
    let Some(alias) = mail_alias(resolver, domain, &incoming.host).await else {
        return inferred;
    };
    let Ok(connector) = tokio_native_tls::native_tls::TlsConnector::new() else {
        return inferred;
    };
    let connector = tokio_native_tls::TlsConnector::from(connector);
    let (imap, smtp) = tokio::join!(
        alias_tls_valid(&connector, &alias, &incoming.host, incoming.port),
        alias_tls_valid(&connector, &alias, &outgoing.host, outgoing.port),
    );
    if imap {
        incoming.host.clone_from(&alias);
    }
    if smtp {
        outgoing.host = alias;
    }
    inferred
}

fn parse_autoconfig(xml: &str, domain: &str, require_domain: bool) -> Option<Discovery> {
    let document = roxmltree::Document::parse(xml).ok()?;
    let provider = document
        .root_element()
        .children()
        .find(|node| node.has_tag_name("emailProvider"))?;
    if !document.root_element().has_tag_name("clientConfig")
        || (require_domain
            && !provider.children().any(|node| {
                node.has_tag_name("domain")
                    && node
                        .text()
                        .is_some_and(|text| text.trim().eq_ignore_ascii_case(domain))
            }))
    {
        return None;
    }
    let endpoint = |tag, protocol| {
        provider
            .children()
            .filter(|node| node.has_tag_name(tag) && node.attribute("type") == Some(protocol))
            .find_map(|server| {
                let value = |name| {
                    server
                        .children()
                        .find(|node| node.has_tag_name(name))?
                        .text()
                        .map(str::trim)
                };
                if !server.children().any(|node| {
                    node.has_tag_name("authentication") && node.text() == Some("password-cleartext")
                }) || value("username").is_some_and(|name| name != "%EMAILADDRESS%")
                {
                    return None;
                }
                let host = value("hostname")?.to_ascii_lowercase();
                let port = value("port")?.parse().ok()?;
                let security = match value("socketType")? {
                    "SSL" => "tls",
                    "STARTTLS" => "starttls",
                    _ => return None,
                };
                (valid_domain(&host) && port > 0).then_some(Endpoint {
                    host,
                    port,
                    security,
                })
            })
    };
    Some(Discovery {
        incoming: endpoint("incomingServer", "imap"),
        outgoing: endpoint("outgoingServer", "smtp"),
        provider: None,
    })
}

async fn fetch_autoconfig(
    client: &reqwest::Client,
    url: String,
    domain: &str,
    require_domain: bool,
) -> Option<Discovery> {
    let mut response = client.get(url).send().await.ok()?.error_for_status().ok()?;
    if !response.status().is_success() {
        return None;
    }
    const MAX_CONFIG_SIZE: usize = 64 * 1024;
    let mut xml = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if xml.len() + chunk.len() > MAX_CONFIG_SIZE {
            return None;
        }
        xml.extend_from_slice(&chunk);
    }
    parse_autoconfig(std::str::from_utf8(&xml).ok()?, domain, require_domain)
}

async fn autoconfig(domain: &str, include_directory: bool) -> Discovery {
    let Ok(client) = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(3))
        .build()
    else {
        return Discovery::default();
    };
    let (subdomain, well_known, directory) = tokio::join!(
        fetch_autoconfig(
            &client,
            format!("https://autoconfig.{domain}/mail/config-v1.1.xml"),
            domain,
            false
        ),
        fetch_autoconfig(
            &client,
            format!("https://{domain}/.well-known/autoconfig/mail/config-v1.1.xml"),
            domain,
            false
        ),
        async {
            if !include_directory {
                return None;
            }
            fetch_autoconfig(
                &client,
                format!("https://autoconfig.thunderbird.net/v1.1/{domain}"),
                domain,
                true,
            )
            .await
        },
    );
    [subdomain, well_known, directory]
        .into_iter()
        .flatten()
        .fold(Discovery::default(), |mut result, settings| {
            result.incoming = result.incoming.or(settings.incoming);
            result.outgoing = result.outgoing.or(settings.outgoing);
            result
        })
}

#[tauri::command]
pub async fn discover_mail_servers(domain: String) -> Result<Discovery, String> {
    let domain = domain.to_ascii_lowercase();
    if !valid_domain(&domain) {
        return Err("Enter a valid email domain.".into());
    }
    if let Some(result) = preset(&domain) {
        return Ok(result);
    }
    let mut builder =
        TokioResolver::builder_tokio().map_err(|_| "The system DNS resolver is unavailable.")?;
    let mut options = ResolverOpts::default();
    options.timeout = Duration::from_secs(2);
    options.attempts = 1;
    *builder.options_mut() = options;
    let resolver = builder
        .build()
        .map_err(|_| "The system DNS resolver is unavailable.")?;
    let (imaps, imap, submissions, submission, hosted) = tokio::join!(
        lookup(&resolver, "_imaps", &domain, "tls"),
        lookup(&resolver, "_imap", &domain, "starttls"),
        lookup(&resolver, "_submissions", &domain, "tls"),
        lookup(&resolver, "_submission", &domain, "starttls"),
        lookup_mx(&resolver, &domain),
    );
    let mut incoming = imaps.or(imap);
    let mut outgoing = submissions.or(submission);
    let mut provider = None;
    if let Some(hosted) = hosted {
        if hosted.provider.is_none() {
            // Prefer explicit settings and verified aliases before using the
            // routing hostname for a protocol.
            if incoming.is_none() || outgoing.is_none() {
                let explicit = autoconfig(&domain, false).await;
                incoming = incoming.or(explicit.incoming);
                outgoing = outgoing.or(explicit.outgoing);
            }
            if incoming.is_none() || outgoing.is_none() {
                let settings = prefer_mxroute_alias(&resolver, &domain, hosted).await;
                incoming = incoming.or(settings.incoming);
                outgoing = outgoing.or(settings.outgoing);
            }
            return Ok(Discovery {
                incoming,
                outgoing,
                provider,
            });
        }
        let matches_host = |public: &Option<Endpoint>, inferred: &Option<Endpoint>| {
            public.as_ref().is_none_or(|endpoint| {
                inferred
                    .as_ref()
                    .is_some_and(|candidate| endpoint.host.eq_ignore_ascii_case(&candidate.host))
            })
        };
        if matches_host(&incoming, &hosted.incoming) && matches_host(&outgoing, &hosted.outgoing) {
            provider = hosted.provider;
        }
        incoming = incoming.or(hosted.incoming);
        outgoing = outgoing.or(hosted.outgoing);
    }
    if incoming.is_none() || outgoing.is_none() {
        let settings = autoconfig(&domain, true).await;
        incoming = incoming.or(settings.incoming);
        outgoing = outgoing.or(settings.outgoing);
    }
    Ok(Discovery {
        incoming,
        outgoing,
        provider,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolver_reads_srv_mx_and_cname_answers_over_loopback() {
        use hickory_resolver::{
            config::{ConnectionConfig, NameServerConfig, ResolverConfig},
            net::runtime::TokioRuntimeProvider,
            proto::{
                op::{Message, OpCode},
                rr::{
                    rdata::{CNAME, MX, SRV},
                    Record, RecordType,
                },
            },
        };
        use tokio::net::UdpSocket;

        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let address = socket.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut buffer = [0; 4096];
            for _ in 0..3 {
                let (len, peer) = socket.recv_from(&mut buffer).await.unwrap();
                let request = Message::from_vec(&buffer[..len]).unwrap();
                let query = &request.queries[0];
                let data = match query.query_type {
                    RecordType::SRV => {
                        RData::SRV(SRV::new(0, 0, 993, "imap.example.test.".parse().unwrap()))
                    }
                    RecordType::MX => {
                        RData::MX(MX::new(10, "safari.mxrouting.net.".parse().unwrap()))
                    }
                    RecordType::CNAME => {
                        assert_eq!(query.name.to_ascii(), "mail.example.test.");
                        RData::CNAME(CNAME("safari.mxrouting.net.".parse().unwrap()))
                    }
                    _ => panic!("unexpected fixture query"),
                };
                let mut reply = Message::response(request.metadata.id, OpCode::Query);
                reply.metadata.recursion_available = true;
                reply.add_query(query.clone());
                reply.add_answer(Record::from_rdata(query.name.clone(), 60, data));
                socket
                    .send_to(&reply.to_vec().unwrap(), peer)
                    .await
                    .unwrap();
            }
        });
        let mut connection = ConnectionConfig::udp();
        connection.port = address.port();
        let config = ResolverConfig::from_name_servers(vec![NameServerConfig::new(
            address.ip(),
            true,
            vec![connection],
        )]);
        let resolver = TokioResolver::builder_with_config(config, TokioRuntimeProvider::default())
            .build()
            .unwrap();
        let endpoint = lookup(&resolver, "_imaps", "example.test", "tls")
            .await
            .unwrap();
        assert_eq!(
            (endpoint.host.as_str(), endpoint.port),
            ("imap.example.test", 993)
        );
        let mx = lookup_mx(&resolver, "example.test").await.unwrap();
        assert_eq!(mx.incoming.unwrap().host, "safari.mxrouting.net");
        assert_eq!(
            mail_alias(&resolver, "example.test", "safari.mxrouting.net")
                .await
                .as_deref(),
            Some("mail.example.test")
        );
        assert!(mail_alias(&resolver, "example.test", "other.mxrouting.net")
            .await
            .is_none());
        server.await.unwrap();
    }

    #[test]
    fn recognizes_mxroute_primary_without_using_an_unrelated_mx_as_a_client_host() {
        assert_eq!(
            mxroute_host([
                (20, "safari-relay.mxrouting.net."),
                (10, "safari.mxrouting.net.")
            ])
            .as_deref(),
            Some("safari.mxrouting.net")
        );
        assert!(mxroute_host([(10, "mail.example.com."), (20, "safari.mxrouting.net.")]).is_none());
        assert!(mxroute_host([(10, "safari.mxrouting.net.example.com.")]).is_none());
        assert!(mxroute_host([(10, "safari-relay.mxrouting.net.")]).is_none());
        assert!(mxroute_host([(10, "safari.mxrouting.net."), (10, "mail.example.com.")]).is_none());
    }

    #[test]
    fn recognizes_hosted_mail_without_reusing_gateway_hostnames() {
        let google = hosted_settings(&[(1, "ASPMX.L.GOOGLE.COM.".into())]).unwrap();
        assert_eq!(google.provider, Some("google"));
        assert_eq!(google.outgoing.unwrap().host, "smtp.gmail.com");

        let microsoft =
            hosted_settings(&[(0, "customer.mail.protection.outlook.com.".into())]).unwrap();
        assert_eq!(microsoft.provider, Some("microsoft"));
        assert_eq!(microsoft.outgoing.unwrap().host, "smtp.office365.com");

        assert!(hosted_settings(&[
            (1, "smtp.google.com.".into()),
            (1, "gateway.example.com.".into()),
        ])
        .is_none());
        assert!(hosted_settings(&[(1, "not-aspmx.l.google.com.".into())]).is_none());
    }

    #[test]
    fn autoconfig_requires_directory_domain_match_and_encrypted_submission() {
        let xml = r#"<clientConfig version="1.1">
          <emailProvider id="example.net">
            <domain>example.net</domain>
            <incomingServer type="imap">
              <hostname>imap.example.net</hostname>
              <port>993</port>
              <socketType>SSL</socketType>
              <username>%EMAILADDRESS%</username>
              <authentication>password-cleartext</authentication>
            </incomingServer>
            <outgoingServer type="smtp">
              <hostname>smtp.example.net</hostname>
              <port>587</port>
              <socketType>STARTTLS</socketType>
              <authentication>password-cleartext</authentication>
            </outgoingServer>
          </emailProvider>
        </clientConfig>"#;
        let settings = parse_autoconfig(xml, "example.net", true).unwrap();
        assert_eq!(settings.incoming.unwrap().host, "imap.example.net");
        assert_eq!(settings.outgoing.unwrap().security, "starttls");
        assert!(parse_autoconfig(xml, "different.net", true).is_none());

        let insecure = xml.replace("STARTTLS", "plain");
        assert!(parse_autoconfig(&insecure, "example.net", true)
            .unwrap()
            .outgoing
            .is_none());
        let oauth_only = xml.replace("password-cleartext", "OAuth2");
        assert!(parse_autoconfig(&oauth_only, "example.net", true)
            .unwrap()
            .incoming
            .is_none());
    }

    #[test]
    fn discovery_accepts_domains_and_known_provider_defaults() {
        assert!(valid_domain("mail.example.com"));
        for invalid in [
            "a@b.com",
            "a.com/path",
            "a..com",
            "-a.com",
            "localhost",
            "a.com.",
        ] {
            assert!(!valid_domain(invalid));
        }
        let google = preset("gmail.com").unwrap();
        assert_eq!(google.provider, Some("google"));
        assert_eq!(google.incoming.unwrap().port, 993);
        assert!(preset("customer.example.com").is_none());
    }
}
