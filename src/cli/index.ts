/** CLI entry point — parse commands and dispatch. */
export function runCli(argv: string[] = process.argv.slice(2)): void {
  const command = argv[0] ?? "start";

  switch (command) {
    case "start":
      console.log("Starting prism-pipe server...");
      // TODO: boot server
      break;
    case "version":
      console.log("prism-pipe v0.1.0");
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

function printHelp(): void {
  console.log(
    `
prism-pipe — AI proxy with configurable rate limiting, fallbacks, and logging

Usage:
  prism-pipe [command] [options]

Commands:
  start       Start the proxy server (default)
  version     Print version information
  help        Show this help message

Options:
  --server.port <port>    Server port (default: 3000)
  --server.host <host>    Server host (default: 0.0.0.0)
  --config <path>         Path to config file
  --help, -h              Show this help message
`.trim(),
  );
}
