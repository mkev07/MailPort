use hickory_resolver::{config::ResolverOpts, system_conf::read_system_conf, TokioAsyncResolver};
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
    resolver: &TokioAsyncResolver,
    service: &str,
    domain: &str,
    security: &'static str,
) -> Option<Endpoint> {
    let records = resolver
        .srv_lookup(format!("{service}._tcp.{domain}."))
        .await
        .ok()?;
    records
        .iter()
        .filter_map(|record| {
            let target = record.target().to_ascii();
            let host = target.trim_end_matches('.');
            (record.port() > 0 && valid_domain(host)).then(|| {
                (
                    record.priority(),
                    record.weight(),
                    Endpoint {
                        host: host.to_owned(),
                        port: record.port(),
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

async fn lookup_mx(resolver: &TokioAsyncResolver, domain: &str) -> Option<Discovery> {
    let records = resolver.mx_lookup(format!("{domain}.")).await.ok()?;
    let targets: Vec<_> = records
        .iter()
        .map(|record| (record.preference(), record.exchange().to_ascii()))
        .collect();
    hosted_settings(&targets)
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

async fn autoconfig(domain: &str) -> Discovery {
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
        fetch_autoconfig(
            &client,
            format!("https://autoconfig.thunderbird.net/v1.1/{domain}"),
            domain,
            true
        ),
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
    let (config, _) = read_system_conf().map_err(|_| "The system DNS resolver is unavailable.")?;
    let mut options = ResolverOpts::default();
    options.timeout = Duration::from_secs(2);
    options.attempts = 1;
    let resolver = TokioAsyncResolver::tokio(config, options);
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
        let settings = autoconfig(&domain).await;
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
