import CONFIG from "./config.json"
import {
  c,
  getClientFromRouter,
  IpMaskGenerator,
  OUT,
  rdGenerator,
} from "./utils"

const pIpGen = new IpMaskGenerator(CONFIG.p_cidr) // Networks between provider routers
const loIpGen = new IpMaskGenerator(CONFIG.lo_cidr) // Loopback networks
const cIpGen = new IpMaskGenerator(CONFIG.c_cidr) // Networks between PE and customer routers

// TODO: ip addresses are bullshit

function conf() {
  const ips: Record<string, string> = {}

  for (const pRouter of CONFIG.provider_routers) {
    // en
    // conf t
    c(`!`)
    c(`hostname ${pRouter.id}`)
    c(`ip cef`)
    c(`router ospf 1`)

    {
      c(`interface Loopback0`)
      c(`ip address ${loIpGen.nextIp()} 255.255.255.255`)
      c(`ip ospf 1 area 0`)
    }

    for (const iface of pRouter.interfaces) {
      c(`interface ${iface.id}`)
      c(`description link to ${iface.neighbor}`)

      const client = getClientFromRouter(iface.neighbor)
      if (!client) {
        const ip = pIpGen.nextIpMask()
        ips[pRouter.id + iface.id] = ip
        c(`ip address ${ip}`)

        c(`ip ospf 1 area 0`)

        // c(`duplex auto`)
        // c(`speed auto`)
        c(`negotiation auto`)

        c(`mpls ip`)

        c(`no shutdown`)
      } else {
        // if PE
        c(`vrf forwarding ${client.id}`)
        c(`ip address ${pIpGen.nextIpMask()}`)
      }
    }

    // if PE

    // clients contains all clients connected to this PE,
    // with 'routers' field containing only the CE routers connected to this PE
    const clients = CONFIG.clients.flatMap((client) => {
      const ceRoutersNeighbors = client.routers.filter((ceRouter) =>
        pRouter.interfaces.find((iface) => {
          iface.id === ceRouter.interfaceId
        })
      )
      if (!ceRoutersNeighbors) return []
      else return [{ ...client, routers: ceRoutersNeighbors }]
    })

    if (clients) {
      for (const client of clients) {
        c(`vrf definition ${client.id}`)
        c(`rd ${CONFIG.as}:${rdGenerator()}`)
        c(`route-target export ${CONFIG.as}:${client.rt_no}`)
        c(`route-target import ${CONFIG.as}:${client.rt_no}`)
        c(`address-family ipv4`)
        c(`exit-address-family`)
      }

      c(`router bgp ${CONFIG.as}`)
      c(`bgp log-neighbor-changes`)

      const pRoutersNeighborsIds = pRouter.interfaces.filter((iface) => {
        return !clients
          .flatMap((client) => client.routers.map((r) => r.id))
          .includes(iface.neighbor)
      })
      for (const pRouterNeighborId of pRoutersNeighborsIds) {
        const ip = pIpGen.nextIpMask()
        ips[pRouter.id + pRouterNeighborId] = ip
        c(`no bgp log-neighbor-changes`)
        c(`neighbor ${ip} remote-as ${CONFIG.as}`)
        c(`neighbor ${ip} update-source Loopback0`)
        c(`address-family vpnv4`)
        c(`neighbor ${ip} activate`)
        c(`neighbor ${ip} send-community both`)
        c(`exit-address-family`)
      }

      for (const client of clients) {
        c(`address-family ipv4 vrf ${client.id}`)

        for (const ceRouter of client.routers) {
          const ip = cIpGen.nextIpMask()
          ips[pRouter.id + ceRouter.interfaceId] = ip
          c(`neighbor ${ip} remote-as ${client.as}`)
          c(`neighbor ${ip} activate`)
        }

        c(`exit-address-family`)
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

      const pe = CONFIG.provider_routers.find((p) =>
        p.interfaces.find((iface) => iface.neighbor === ceRouter.id)
      )
      if (!pe)
        throw new Error(`Router connected to ${ceRouter.interfaceId} not found`)

      c(`description link to ${pe.id}`)

      const peIface = pe.interfaces.find(
        (iface) => iface.neighbor === ceRouter.id
      )
      if (!peIface) throw new Error(`Interface not found`)
      const ip = ips[pe.id + peIface.id]
      if (!ip) throw new Error(`IP not found`)

      c(`neighbor ${ip} remote-as ${CONFIG.as}`)
    }
  }
  console.log(OUT.join("\n"))
}

conf()
