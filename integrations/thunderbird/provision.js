// Runs in Thunderbird's chrome context through the disposable test harness.
async function provision(account, inspectOnly) {
  const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
  const { CreateInBackend } = ChromeUtils.importESModule(
    "resource:///modules/accountcreation/CreateInBackend.sys.mjs",
  );
  const { AccountConfig } = ChromeUtils.importESModule(
    "resource:///modules/accountcreation/AccountConfig.sys.mjs",
  );
  const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

  if (!Services.io.offline || account.incoming.host !== "imap.example.test" ||
      account.outgoing.host !== "smtp.example.test" ||
      !account.email.endsWith("@example.com")) {
    throw new Error("Expected an offline synthetic Thunderbird account");
  }
  const servers = [account.incoming, account.outgoing];
  const schemes = ["imap", "smtp"];
  const originFor = index => `${schemes[index]}://${servers[index].host}`;
  const logins = async index => {
    const origin = originFor(index);
    const candidates = await Services.logins.searchLoginsAsync({ origin, httpRealm: origin });
    return candidates.filter(login =>
      login.formActionOrigin === null && login.username === servers[index].username);
  };
  const socketType = server => server.security === "tls" ? Ci.nsMsgSocketType.SSL : Ci.nsMsgSocketType.alwaysSTARTTLS;
  const incomingHostname = server => server.hostname ?? server.hostName;
  const sameServer = (server, actual, hostname) => actual &&
    hostname === server.host && actual.username === server.username &&
    actual.port === server.port && actual.socketType === socketType(server) &&
    actual.authMethod === Ci.nsMsgAuthMethod.passwordCleartext;

  const journalPath = PathUtils.join(PathUtils.profileDir, "mailport-pending.json");
  const identity = [
    account.id, account.email, account.displayName,
    ...servers.map(({ host, port, security, username }) => [host, port, security, username]),
  ];
  let journal = await IOUtils.readJSON(journalPath).catch(error => {
    if (error.name === "NotFoundError") return null;
    throw error;
  });
  const ownsJournal = () => journal?.version === 1 &&
    JSON.stringify(journal.identity) === JSON.stringify(identity) &&
    Array.isArray(journal.guids) && journal.guids.length === 2 &&
    journal.guids.every(guid => typeof guid === "string" && /^\{[0-9a-f-]{36}\}$/i.test(guid)) &&
    journal.guids[0] !== journal.guids[1];
  const loginMatches = (index, login) => login.password === servers[index].auth.password;
  const ownsLogin = (index, login) =>
    login.QueryInterface(Ci.nsILoginMetaInfo).guid === journal.guids[index] && loginMatches(index, login);
  const smtpOwnerPref = server => `mail.smtpserver.${server.key}.mailportImport`;
  const incomingPrefs = Services.prefs.getBranch("mail.server.");
  const incomingKeys = () => new Set(incomingPrefs.getChildList("")
    .map(pref => /^(server\d+)\./.exec(pref)?.[1]).filter(Boolean));
  const incomingOwnerPref = key => `${key}.mailportImport`;
  const findOutgoing = () => MailServices.outgoingServer.findServer(
    account.outgoing.username, account.outgoing.host, "smtp",
  )?.QueryInterface(Ci.nsISmtpServer);
  const ownsOutgoing = server => !server || (
    Services.prefs.getStringPref(smtpOwnerPref(server), "") === journal.guids[1] &&
    sameServer(account.outgoing, server, server.hostname) &&
    !MailServices.accounts.allIdentities.some(identity => identity.smtpServerKey === server.key)
  );
  const getLogins = () => Promise.all(schemes.map((_, index) => logins(index)));
  const inspect = async () => {
    const [imap, smtp] = await getLogins();
    const accounts = MailServices.accounts.accounts.filter(item =>
      item.identities.some(identity => identity.email.toLowerCase() === account.email.toLowerCase()) ||
      (item.incomingServer?.type === "imap" &&
        incomingHostname(item.incomingServer) === account.incoming.host &&
        item.incomingServer.username === account.incoming.username));
    if (!accounts.length) {
      const outgoing = findOutgoing();
      if (!journal && !outgoing && !imap.length && !smtp.length) return "absent";
      if (ownsJournal() && ownsOutgoing(outgoing) && [imap, smtp].every((found, index) =>
        !found.length || (found.length === 1 && ownsLogin(index, found[0])),
      )) return "pending";
    }
    if (accounts.length !== 1 || imap.length !== 1 || smtp.length !== 1) return "conflict";

    const saved = accounts[0];
    const identity = saved.defaultIdentity;
    const incoming = saved.incomingServer;
    const server = identity?.smtpServerKey && MailServices.outgoingServer.getServerByKey(identity.smtpServerKey);
    const outgoing = server?.type === "smtp" ? server.QueryInterface(Ci.nsISmtpServer) : null;
    if (identity?.email !== account.email || identity?.fullName !== account.displayName ||
        incoming?.type !== "imap" || outgoing?.type !== "smtp" ||
        !sameServer(account.incoming, incoming, incomingHostname(incoming)) ||
        !sameServer(account.outgoing, outgoing, outgoing.serverURI.host) ||
        !loginMatches(0, imap[0]) || !loginMatches(1, smtp[0])) {
      return "conflict";
    }
    return "match";
  };

  async function waitForSavedLogins() {
    const store = PathUtils.join(PathUtils.profileDir, "logins.json");
    const deadline = performance.now() + 10000;
    do {
      const persisted = await IOUtils.readJSON(store).catch(error => {
        if (error.name === "NotFoundError") return { logins: [] };
        throw error;
      });
      if (journal.guids.every(guid => persisted.logins.some(login => login.guid === guid))) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (performance.now() < deadline);
    throw new Error("Thunderbird login store did not persist the imported credentials");
  }

  async function finish(saved, outgoing) {
    saved.incomingServer.doBiff = false;
    const defaultServer = MailServices.outgoingServer.defaultServer;
    if (!defaultServer?.serverURI?.host) MailServices.outgoingServer.defaultServer = outgoing;
    const ownerPref = smtpOwnerPref(outgoing);
    if (Services.prefs.getStringPref(ownerPref, "") === journal.guids[1]) {
      Services.prefs.clearUserPref(ownerPref);
    }
    const accountPrefs = Services.prefs.getBranch("mail.account.");
    const linkedKeys = new Set(accountPrefs.getChildList("")
      .filter(pref => /^account\d+\.server$/.test(pref))
      .map(pref => accountPrefs.getStringPref(pref, "")));
    for (const key of incomingKeys()) {
      const marker = incomingOwnerPref(key);
      if (incomingPrefs.getStringPref(marker, "") !== journal.guids[0]) continue;
      if (key === saved.incomingServer.key) {
        incomingPrefs.clearUserPref(marker);
        continue;
      }
      if (linkedKeys.has(key) || MailServices.accounts.accounts.some(item => item.incomingServer?.key === key)) {
        continue;
      }
      if (incomingPrefs.getStringPref(`${key}.type`, "") !== "imap" ||
          incomingPrefs.getStringPref(`${key}.hostname`, "") !== account.incoming.host ||
          incomingPrefs.getStringPref(`${key}.userName`, "") !== account.incoming.username) {
        continue;
      }
      // Only remove user settings. Calling Thunderbird's server removal API
      // can affect folders or the login shared with the recovered account.
      for (const pref of incomingPrefs.getChildList(`${key}.`)) {
        if (pref !== marker && incomingPrefs.prefHasUserValue(pref)) incomingPrefs.clearUserPref(pref);
      }
      incomingPrefs.clearUserPref(marker);
    }
    Services.prefs.savePrefFile(null);
    await IOUtils.remove(journalPath);
  }

  const existing = await inspect();
  if (inspectOnly) return existing;
  if (existing === "conflict") throw new Error("Conflicting Thunderbird account or credentials");
  if (existing === "match") {
    if (ownsJournal()) {
      if (!(await getLogins()).every(([login], index) => login && ownsLogin(index, login))) {
        throw new Error("Conflicting Thunderbird login during import");
      }
      const saved = MailServices.accounts.accounts.find(item => item.defaultIdentity?.email === account.email);
      const outgoing = MailServices.outgoingServer.getServerByKey(saved.defaultIdentity.smtpServerKey);
      await waitForSavedLogins();
      await finish(saved, outgoing);
    }
    return existing;
  }

  if (existing === "absent") {
    journal = { version: 1, identity, guids: schemes.map(() => Services.uuid.generateUUID().toString()) };
    await IOUtils.writeJSON(journalPath, journal, {
      mode: "create", tmpPath: `${journalPath}.${Services.uuid.generateUUID()}.tmp`, flush: true,
    });
  }
  for (const [index, server] of servers.entries()) {
    const [savedLogin] = await logins(index);
    if (savedLogin) {
      if (!ownsLogin(index, savedLogin)) {
        throw new Error("Conflicting Thunderbird login during import");
      }
      continue;
    }
    const origin = originFor(index);
    const login = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(Ci.nsILoginInfo);
    login.init(origin, null, origin, server.username, server.auth.password, "", "");
    login.QueryInterface(Ci.nsILoginMetaInfo).guid = journal.guids[index];
    await Services.logins.addLoginAsync(login);
  }
  await waitForSavedLogins();

  let outgoing = findOutgoing();
  if (!ownsOutgoing(outgoing)) throw new Error("Conflicting Thunderbird outgoing server during import");
  if (!outgoing) {
    outgoing = MailServices.outgoingServer.createServer("smtp").QueryInterface(Ci.nsISmtpServer);
    outgoing.hostname = account.outgoing.host;
    outgoing.port = account.outgoing.port;
    outgoing.username = account.outgoing.username;
    outgoing.authMethod = Ci.nsMsgAuthMethod.passwordCleartext;
    outgoing.socketType = socketType(account.outgoing);
    outgoing.description = account.displayName;
    Services.prefs.setStringPref(smtpOwnerPref(outgoing), journal.guids[1]);
    Services.prefs.savePrefFile(null);
  }

  const config = new AccountConfig();
  const connection = (server, type) => ({
    type,
    hostname: server.host,
    port: server.port,
    username: server.username,
    password: server.auth.password,
    auth: Ci.nsMsgAuthMethod.passwordCleartext,
    socketType: socketType(server),
  });
  Object.assign(config.incoming, connection(account.incoming, "imap"), { loginAtStartup: false });
  Object.assign(config.outgoing, connection(account.outgoing, "smtp"), { existingServerKey: outgoing.key });
  Object.assign(config.identity, { realname: account.displayName, emailAddress: account.email });
  config.displayName = account.displayName;
  config.rememberPassword = false; // Both logins have already been saved through the login manager.
  const previousKeys = incomingKeys();
  // Thunderbird 138 reads the port immediately after allocating the server.
  // Mark that exact allocation before a later native write can persist it.
  Object.defineProperty(config.incoming, "port", {
    get() {
      const allocated = [...incomingKeys()].filter(key => !previousKeys.has(key));
      if (allocated.length !== 1 ||
          incomingPrefs.getStringPref(`${allocated[0]}.type`, "") !== "imap" ||
          incomingPrefs.getStringPref(`${allocated[0]}.hostname`, "") !== account.incoming.host ||
          incomingPrefs.getStringPref(`${allocated[0]}.userName`, "") !== account.incoming.username) {
        throw new Error("Could not identify the incoming server allocated by Thunderbird");
      }
      incomingPrefs.setStringPref(incomingOwnerPref(allocated[0]), journal.guids[0]);
      return account.incoming.port;
    },
  });
  const saved = await CreateInBackend.createAccountInBackend(config);
  if (await inspect() !== "match") throw new Error("Thunderbird did not retain the requested account and logins");
  await finish(saved, outgoing);
  return existing === "pending" ? "recovered" : "created";
}
