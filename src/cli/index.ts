/**
 * CLI commands: start, help, version
 */

export async function cliCommand(args: string[]): Promise<void> {
  const command = args[0]

  switch (command) {
    case "--help":
    case "-h":
      console.log(`
Usage: prism-pipe [command] [options]

Commands:
  start    Start the proxy server
  help     Show this help message
  version  Show version

Options:
  --config <path>  Path to config file
  --port <port>    Server port (default: 3000)
  --help           Show help
  --version        Show version
      `)
      break

    case "--version":
    case "-v":
      console.log("prism-pipe 0.1.0")
      break

    default:
      throw new Error("Not implemented")
  }
}
