import { Command } from "commander";
import { ConfigStore } from "../config-store.js";

export function configCommand(configPath?: string): Command {
  const cmd = new Command("config").description("Inspect and change Rigged configuration");
  const store = new ConfigStore(configPath);

  cmd
    .option("--json", "JSON output for agents")
    .addHelpText("after", `
Examples:
  rigged config                           # show all resolved config
  rigged config --json                    # JSON output
  rigged config get daemon.port           # read a single key
  rigged config set daemon.port 7434      # change a value
  rigged config reset                     # delete config file, revert to defaults

Keys: daemon.port, daemon.host, db.path, transcripts.enabled, transcripts.path
Precedence: CLI flag > environment variable > config file > default`)
    .action((opts: { json?: boolean }) => {
      try {
        const config = store.resolve();
        if (opts.json) {
          console.log(JSON.stringify(config, null, 2));
        } else {
          console.log(`daemon.port           ${config.daemon.port}`);
          console.log(`daemon.host           ${config.daemon.host}`);
          console.log(`db.path               ${config.db.path}`);
          console.log(`transcripts.enabled   ${config.transcripts.enabled}`);
          console.log(`transcripts.path      ${config.transcripts.path}`);
        }
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
      }
    });

  const getCmd = new Command("get")
    .argument("<key>", "Config key (e.g. daemon.port)")
    .description("Read a single config value")
    .action((key: string) => {
      try {
        console.log(String(store.get(key)));
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
      }
    });

  const setCmd = new Command("set")
    .argument("<key>", "Config key (e.g. daemon.port)")
    .argument("<value>", "Value to set")
    .description("Set a config value")
    .action((key: string, value: string) => {
      try {
        store.set(key, value);
        console.log(`${key} = ${store.get(key)}`);
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
      }
    });

  const resetCmd = new Command("reset")
    .description("Delete config file and revert to defaults")
    .action(() => {
      store.reset();
      console.log("Config reset to defaults.");
    });

  cmd.addCommand(getCmd);
  cmd.addCommand(setCmd);
  cmd.addCommand(resetCmd);

  return cmd;
}
