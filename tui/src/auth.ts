import { startDeviceFlow, pollDeviceFlow, isAuthenticated } from './innertube.js';

if (isAuthenticated()) {
  console.log('✓ Já autenticado! Use npm start para iniciar o TUI.');
  process.exit(0);
}

console.log('Iniciando autenticação OAuth2...');
const flow = await startDeviceFlow();

console.log('\n══════════════════════════════════════════');
console.log(`1. Acesse: ${flow.verification_url}`);
console.log(`2. Digite o código: ${flow.user_code}`);
console.log('══════════════════════════════════════════\n');
console.log('Aguardando confirmação...');

let done = false;
while (!done) {
  done = await pollDeviceFlow(flow.device_code, flow.interval);
}

console.log('\n✓ Autenticado com sucesso! Use npm start para iniciar o TUI.');
