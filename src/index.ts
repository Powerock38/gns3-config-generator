import CONFIG from "./config.json";

const OUT: string[] = [];

for (const pRouter of CONFIG.providers_routers) {
  OUT.push(`hostname ${pRouter.id}`);
}

console.log(OUT.join("\n"));
