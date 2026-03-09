import { cliCommand } from "@cli";
import { logger } from "@logging/logger";
/**
 * Entry point — parse CLI args, boot server
 */
async function main() {
    try {
        const args = process.argv.slice(2);
        await cliCommand(args);
    }
    catch (error) {
        logger.error(error, "Fatal error");
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map