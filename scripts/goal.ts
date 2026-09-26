const base = `http://127.0.0.1:${process.env.CONTROL_PORT ?? '8787'}`;
const [command, ...rest] = process.argv.slice(2);

async function main(): Promise<void> {
  if (command === 'set') {
    const goal = rest.join(' ').trim();
    if (!goal) throw new Error('Usage: npm run goal -- set <goal>');
    console.log(await (await fetch(`${base}/goal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal }),
    })).text());
    return;
  }
  if (command === 'clear') {
    console.log(await (await fetch(`${base}/goal`, { method: 'DELETE' })).text());
    return;
  }
  if (command === 'status') {
    console.log(await (await fetch(`${base}/status`)).text());
    return;
  }
  if (command === 'pause' || command === 'resume' || command === 'emergency-stop') {
    console.log(await (await fetch(`${base}/${command}`, { method: 'POST' })).text());
    return;
  }
  throw new Error('Usage: npm run goal -- <set|clear|status|pause|resume|emergency-stop> [goal]');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
