const { ExtensionAPI } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs")
  .ExtensionCommon;

let saving = false;
const isAvailable = () => Services.io.offline &&
  Services.prefs.getBoolPref("mailport.preview.enabled", false);

this.mailPortPreview = class extends ExtensionAPI {
  getAPI() {
    return {
      mailPortPreview: {
        async isAvailable() {
          return isAvailable();
        },
        async saveSyntheticAccount(account) {
          if (!isAvailable() || saving) throw new Error("MailPort preview unavailable");
          if (account?.incoming?.auth?.type !== "password" || account?.outgoing?.auth?.type !== "password") {
            throw new Error("The preview supports synthetic password accounts only");
          }
          saving = true;
          try {
            await provision(account, false);
          } catch {
            throw new Error("Thunderbird could not save the synthetic account");
          } finally {
            saving = false;
          }
        },
      },
    };
  }
};
