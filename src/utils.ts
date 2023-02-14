import CONFIG from "./config.json"

let currentRd = 0
export function rdGenerator() {
  const c = currentRd
  currentRd++
  if (currentRd === 65535) {
    throw new Error("RD exhausted")
  }
  return c
}

export function getClientFromCEid(ceId: string) {
  return CONFIG.clients.find((client) =>
    client.routers.find((ce) => ce.id === ceId)
  )
}
