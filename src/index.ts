import CONFIG from "./config.json";

const OUT: string[] = [];

// a function that yields a valid IP address in CONFIG.ip_range
function* ipGenerator() {
  const [start, end] = CONFIG.ip_range.split("-");
  const [start1, start2, start3, start4] = start.split(".");
  const [end1, end2, end3, end4] = end.split(".");
  let [cur1, cur2, cur3, cur4] = [start1, start2, start3, start4];

  while (true) {
    yield `${cur1}.${cur2}.${cur3}.${cur4}`;

    if (cur4 === end4) {
      cur4 = "0";
      if (cur3 === end3) {
        cur3 = "0";
        if (cur2 === end2) {
          cur2 = "0";
          if (cur1 === end1) {
            throw new Error("IP range exhausted");
          } else {
            cur1 = (parseInt(cur1) + 1).toString();
          }
        } else {
          cur2 = (parseInt(cur2) + 1).toString();
        }
      } else {
        cur3 = (parseInt(cur3) + 1).toString();
      }
    } else {
      cur4 = (parseInt(cur4) + 1).toString();
    }
  }
}

// a function that yields a RD number between 0 - 65535
function* rdGenerator() {
  let cur = 0;
  while (true) {
    yield cur;
    cur++;
    if (cur === 65535) {
      throw new Error("RD exhausted");
    }
  }
}

function c(cmd: string) {
  OUT.push(cmd);
}

function getClient(clientId: string) {
  const c = CONFIG.vpn_clients.find((c) => c.id === clientId);
  if (!c) {
    throw new Error(`Client ${clientId} not found`);
  }
  return c;
}

for (const pRouter of CONFIG.provider_routers) {
  // en
  // conf t
  c(`hostname ${pRouter.id}`);
  c(`ip cef`);
  c(`router ospf 1`);

  if (pRouter.loopback) {
    c(`interface ${pRouter.loopback}`);
    c(`ip address ${ipGenerator()} ${"TODO mask"}`); // Maybe use a different generator for loopback IPs
    // c(`ip ospf network point-to-point`);
    c(`ip ospf 1 area 0`);
  }

  for (const inf of pRouter.interfaces) {
    c(`interface ${inf.id}`);
    c(`ip address ${ipGenerator()} ${"TODO mask"}`);

    // c(`ip ospf network point-to-point`);
    c(`ip ospf 1 area 0`);

    c(`duplex auto`);
    c(`speed auto`);

    c(`mpls ip`);

    c(`no shutdown`);
  }

  if (pRouter.edge && pRouter.vpn_clients.length > 0) {
    for (const clientId of pRouter.vpn_clients) {
      const client = getClient(clientId);

      c(`vrf definition ${clientId}`);
      c(`rd ${CONFIG.as}:${rdGenerator()}`);
      c(`route-target export ${CONFIG.as}:${client.rt_no}`);
      c(`route-target import ${CONFIG.as}:${client.rt_no}`);
      c(`address-family ipv4`);
      c(`exit-address-family`);
    }
  }
}

console.log(OUT.join("\n"));
