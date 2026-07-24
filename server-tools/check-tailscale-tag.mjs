const requiredTag = process.env.TAILSCALE_REQUIRED_TAG || "tag:axora-render";
let input = "";

for await (const chunk of process.stdin) input += chunk;

try {
  const status = JSON.parse(input);
  const tags = Array.isArray(status?.Self?.Tags) ? status.Self.Tags : [];
  if (!tags.includes(requiredTag)) {
    console.error(`Tailscale node is missing required ${requiredTag}.`);
    process.exit(1);
  }
} catch {
  console.error("Could not validate the Tailscale node identity.");
  process.exit(1);
}
