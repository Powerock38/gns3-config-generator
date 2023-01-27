import CONFIG from "./config.json"
import { c, getClient, IpMaskGenerator, OUT, rdGenerator } from "./utils"

const pIpGen = new IpMaskGenerator(CONFIG.p_cidr) // Networks between provider routers
const loIpGen = new IpMaskGenerator(CONFIG.lo_cidr) // Loopback networks
const cIpGen = new IpMaskGenerator(CONFIG.c_cidr) // Networks between PE and customer routers

// todo infer is edge from interfaces neighbors
// and fetch corresponding client

function conf() {
  const ips: Record<string, string> = {}

  for (const pRouter of CONFIG.provider_routers) {
    // en
    // conf t
    c(`!`)
    c(`hostname ${pRouter.id}`)
    c(`ip cef`)
    c(`router ospf 1`)

    c(`interface Loopback0`)
    c(`ip address ${loIpGen.nextIp()} 255.255.255.255`)
    // c(`ip ospf network point-to-point`);
    c(`ip ospf 1 area 0`)

    for (const iface of pRouter.interfaces) {
      c(`interface ${iface.id}`)
      const ip = pIpGen.nextIpMask()
      ips[pRouter.id + iface.id] = ip
      c(`ip address ${ip}`)

      // c(`ip ospf network point-to-point`);
      c(`ip ospf 1 area 0`)

      c(`duplex auto`)
      c(`speed auto`)

      c(`mpls ip`)

      c(`no shutdown`)
    }

    if (pRouter.edge) {
      if (pRouter.clients.length > 0) {
        for (const clientId of pRouter.clients) {
          const client = getClient(clientId)

          c(`vrf definition ${clientId}`)
          c(`rd ${CONFIG.as}:${rdGenerator()}`)
          c(`route-target export ${CONFIG.as}:${client.rt_no}`)
          c(`route-target import ${CONFIG.as}:${client.rt_no}`)
          c(`address-family ipv4`)
          c(`exit-address-family`)
        }

        c(`interface Loopback0`)
        c(`ip address ${pIpGen.nextIpMask()}`)

        for (const iface of pRouter.interfaces) {
          c(`interface ${iface.id}`)

          for (const clientId of pRouter.clients) {
            c(`vrf forwarding ${clientId}`)
            c(`ip address ${pIpGen.nextIpMask()}`)
            c(`duplex auto`)
            c(`speed auto`)
            c(`media-type rj45`)
          }
        }
      }
    }
  }

  for (const client of CONFIG.clients) {
    for (const ceRouter of client.routers) {
      c(`!`)
      c(`hostname ${ceRouter.id}`)
      c(`ip cef`)

      c(`interface ${ceRouter.interfaceId}`)
      c(`duplex auto`)
      c(`speed auto`)
      c(`media-type rj45`)

      c(`router bgp ${client.as}`)
      c(`bgp log-neighbor-changes`)
      c(`redistribute connected`)
      const pe = CONFIG.provider_routers.find(
        (r) => r.id === ceRouter.neighbor && r.edge
      )
      if (!pe) throw new Error(`Router ${ceRouter.neighbor} not found`)
      const peIface = pe.interfaces.find((i) => i.neighbor === ceRouter.id)
      if (!peIface) throw new Error(`Interface not found`)
      const ip = ips[pe.id + peIface.id]
      if (!ip) throw new Error(`IP not found`)
      c(`neighbor ${ip} remote-as ${CONFIG.as}`)
    }
  }
  console.log(OUT.join("\n"))
}

conf()
