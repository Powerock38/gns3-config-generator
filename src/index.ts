#!/usr/bin/env node

import { Command } from "commander"
import fs from "fs"
import path from "path"
import { configure, configureCE } from "./configure"
import { IpGen } from "./IpGen"
import { c, openTelnet } from "./telnet"
import {
  CERouter,
  CERouterJson,
  Client,
  Config,
  ConfigJson,
  PInterface,
  PInterfaceJson,
  PRouter,
  PRouterJson,
} from "./types"

function userConfigIntoGeneratedConfig(configJson: any): Config {
  const clients: Client[] = []
  const pRouters: PRouter[] = []

  const loIPPool = IpGen.fromCIDR(configJson.loCIDR)
  const pIPPool = IpGen.fromCIDR(configJson.pCIDR)

  for (const pRouter of configJson.pRouters) {
    const interfaces: PInterface[] = []

    for (const iface of pRouter.interfaces) {
      let neighborIface: PInterface | undefined
      for (const pRouterNeighbor of pRouters) {
        if (iface.neighbor === pRouterNeighbor.id) {
          for (const ifaceNeighbor of pRouterNeighbor.interfaces) {
            if (ifaceNeighbor.neighbor === pRouter.id) {
              neighborIface = ifaceNeighbor
              break
            }
          }
        }
      }

      let ip: IpGen
      if (neighborIface) {
        ip = neighborIface.ip.getNext(30)
      } else {
        ip = pIPPool.getNext(30)
        pIPPool.incrementSelf(4)
      }

      interfaces.push({
        id: iface.id,
        neighbor: iface.neighbor,
        ip,
      })
    }

    pRouters.push({
      id: pRouter.id,
      telnetHost: pRouter.telnetHost,
      interfaces,
      ipLo: loIPPool.getNext(32),
      isPE: false, // correctly set in next loop
    })

    loIPPool.incrementSelf(1)
  }

  // index in array = rtGroup
  const clientsId: string[] = configJson.clients.map((c: any) => c.id)

  // each CE router has a unique RD
  let rd = 0

  for (const client of configJson.clients) {
    const routers: CERouter[] = []

    for (const ceRouter of client.routers) {
      let neighborIface: PInterface | undefined
      for (const pRouterNeighbor of pRouters) {
        for (const ifaceNeighbor of pRouterNeighbor.interfaces) {
          if (ifaceNeighbor.neighbor === ceRouter.id) {
            neighborIface = ifaceNeighbor
            pRouterNeighbor.isPE = true
            break
          }
        }
      }

      if (!neighborIface) {
        throw new Error("No PE found for CE " + ceRouter.id)
      }

      routers.push({
        id: ceRouter.id,
        asn: ceRouter.asn,
        telnetHost: ceRouter.telnetHost,
        interfaceId: ceRouter.interfaceId,
        interfaceIp: neighborIface.ip.getNext(30),
        rd: rd++,
      })

      if (rd > 65535) {
        throw new Error("RD exhausted")
      }
    }

    clients.push({
      id: client.id,
      rtGroup: clientsId.indexOf(client.id),
      friendsRtGroup: client.friends.map((clientId: string) =>
        clientsId.indexOf(clientId)
      ),
      routers,
    })
  }

  return { asn: configJson.asn, pIPPool, loIPPool, pRouters, clients }
}

async function detectNewCEsAndConfigure(
  configJson: ConfigJson,
  configGenerated: Config
) {
  let rd =
    Math.max(
      ...configGenerated.clients.flatMap((c) => c.routers.map((r) => r.rd))
    ) + 1

  // detect added CE in config that are not in configGenerated
  const newCEs: {
    client: Client
    pe: PRouter
    peIfaceJson: PInterfaceJson
    ceJson: CERouterJson
  }[] = []
  for (const clientJson of configJson.clients) {
    const clientGenerated = configGenerated.clients.find(
      (c) => c.id === clientJson.id
    )
    if (!clientGenerated) {
      throw new Error("New client detected: not supported yet")
    } else {
      for (const ceJson of clientJson.routers) {
        const ceGenerated = clientGenerated.routers.find(
          (c) => c.id === ceJson.id
        )
        if (!ceGenerated) {
          console.log(`New CE ${ceJson.id} detected`)

          // find corresponding PE and interface in configGenerated
          let peJson: PRouterJson | undefined
          let peIfaceJson: PInterfaceJson | undefined
          for (const pRouterJson of configJson.pRouters) {
            for (const iface of pRouterJson.interfaces) {
              if (iface.neighbor === ceJson.id) {
                peJson = pRouterJson
                peIfaceJson = iface
                break
              }
            }
          }
          if (!peJson || !peIfaceJson) {
            throw new Error("No PE found for CE " + ceJson.id)
          }

          // to be sure that the PE and the Client was in configGenerated
          const pe = configGenerated.pRouters.find((p) => p.id === peJson!.id)
          const client = configGenerated.clients.find(
            (c) => c.id === clientJson.id
          )

          if (!pe || !client) {
            throw new Error("PE or Client not found in configGenerated")
          }

          newCEs.push({ client, pe, peIfaceJson, ceJson })
        }
      }
    }
  }

  for (const { client, pe, peIfaceJson, ceJson } of newCEs) {
    const peIface: PInterface = {
      id: peIfaceJson.id,
      neighbor: peIfaceJson.neighbor,
      ip: configGenerated.pIPPool.getNext(30),
    }

    const ce: CERouter = {
      id: ceJson.id,
      asn: ceJson.asn,
      interfaceId: ceJson.interfaceId,
      telnetHost: ceJson.telnetHost,
      rd: rd++,
      interfaceIp: peIface.ip.getNext(30),
    }

    configGenerated.pIPPool.incrementSelf(4)

    // update configGenerated
    pe.interfaces.push(peIface)
    client.routers.push(ce)

    console.log(`IP on PE will be ${peIface.ip.toStringWithMask()}`)
    console.log(`IP on CE will be ${ce.interfaceIp.toStringWithMask()}`)

    await openTelnet(pe.telnetHost)

    await c(`vrf definition ${ce.id}`)
    await c(`rd ${configJson.asn}:${ce.rd}`)
    await c(`route-target export ${configJson.asn}:${client.rtGroup}`)
    await c(`route-target import ${configJson.asn}:${client.rtGroup}`)
    for (const rtGroup of client.friendsRtGroup) {
      await c(`route-target import ${configJson.asn}:${rtGroup}`)
    }
    await c(`address-family ipv4`)
    await c(`exit-address-family`)

    await c(`interface ${peIface.id}`)
    await c(`description link to ${peIface.neighbor}`)
    await c(`vrf forwarding ${peIface.neighbor}`)
    await c(`ip address ${peIface.ip.toStringWithMask()}`)
    await c(`no shutdown`)

    await c(`router bgp ${configJson.asn}`)
    await c(`address-family ipv4 vrf ${ce.id}`)
    await c(`neighbor ${ce.interfaceIp} remote-as ${ce.asn}`)
    await c(`neighbor ${ce.interfaceIp} activate`)
    await c(`exit-address-family`)

    await configureCE(ce, pe.id, peIface.ip, configJson.asn)
  }
}

console.log("             _                        _       ")
console.log("  __ _ _   _| |_ ___  _ __ ___  _   _| |_ ___ ")
console.log(" / _` | | | | __/ _ \\| '__/ _ \\| | | | __/ _ \\")
console.log("| (_| | |_| | || (_) | | | (_) | |_| | ||  __/")
console.log(" \\__,_|\\__,_|\\__\\___/|_|  \\___/ \\__,_|\\__\\___|\n")

const program = new Command()

program
  .name("autoroute")
  .version("1.0.0")
  .description("Auto-configure a whole MPLS VPN network from a config file")
  .argument("<config-path>", "Path to your hand-written config file")
  .action(async (configPath) => {
    const configPathResolved = path.parse(path.resolve(configPath))
    const genConfigPath = path.resolve(
      configPathResolved.dir,
      configPathResolved.name + ".generated.json"
    )

    const configJson = JSON.parse(
      fs.readFileSync(configPath, "utf8")
    ) as ConfigJson

    let configGeneratedJson = undefined
    try {
      configGeneratedJson = JSON.parse(fs.readFileSync(genConfigPath, "utf8"))
      IpGen.deserializeInObject(configGeneratedJson)
      console.log("Generated config found")
    } catch (e) {
      // no generated config found
    }

    if (configGeneratedJson) {
      const configGenerated = configGeneratedJson as Config
      await detectNewCEsAndConfigure(configJson, configGenerated)
      fs.writeFileSync(genConfigPath, JSON.stringify(configGenerated))
      console.log(`Re-wrote generated config in : ${genConfigPath}`)
    } else {
      const config = userConfigIntoGeneratedConfig(configJson)
      await configure(config)
      fs.writeFileSync(genConfigPath, JSON.stringify(config))
      console.log(`Wrote generated config in : ${genConfigPath}`)
    }

    console.log("\nDONE")
    process.exit()
  })
  .parse(process.argv)
