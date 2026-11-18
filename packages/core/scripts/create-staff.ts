/**
 * Creates a staff member. Run it in YOUR OWN terminal window:
 *
 *     npm run staff:create
 *
 * It asks for the email, name, role and password. The password is typed with the characters
 * hidden and goes straight to the sign-in system. It is never saved in a file, in git, or in
 * any chat.
 */
import path from "node:path";
import readline from "node:readline";
import { config } from "dotenv";
import { MIN_PASSWORD_LENGTH, createStaffInput, createStaffUser, getDb } from "../src/index";

config({ path: path.resolve(process.cwd(), "../../.env.local"), quiet: true });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      console.error("\nA password can only be typed in a real terminal window. Run this yourself.");
      process.exit(1);
    }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        value += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  console.log("\nCreate a staff member\n---------------------");
  const email = (await ask("Email address: ")).toLowerCase();
  const name = await ask("First name (as it should show in the app): ");
  const roleAnswer =
    (await ask("Role - OWNER, MANAGER or CREW [OWNER]: ")).toUpperCase() || "OWNER";

  const password = await askHidden(
    `Password (at least ${MIN_PASSWORD_LENGTH} characters, hidden): `,
  );
  const again = await askHidden("Type the password again: ");
  if (password !== again) {
    console.error("\nThe two passwords did not match. Nothing was created.");
    process.exit(1);
  }

  const parsed = createStaffInput.safeParse({ email, name, role: roleAnswer, password });
  if (!parsed.success) {
    console.error("\nNothing was created:");
    for (const issue of parsed.error.issues) console.error(`  - ${issue.message}`);
    process.exit(1);
  }

  const staff = await createStaffUser(parsed.data);
  console.log(`\nCreated ${staff.role} account for ${staff.name} (${staff.email}).`);
  console.log("Next: start the staff app (npm run dev:admin), open http://localhost:3100,");
  console.log("sign in, and set up your authenticator app when asked.\n");
  await getDb().$disconnect();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFailed: ${message.replace(/:[^:@/\s]+@/g, ":****@")}`);
  process.exit(1);
});
