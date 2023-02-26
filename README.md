```
             _                        _
  __ _ _   _| |_ ___  _ __ ___  _   _| |_ ___
 / _` | | | | __/ _ \| '__/ _ \| | | | __/ _ \
| (_| | |_| | || (_) | | | (_) | |_| | ||  __/
 \__,_|\__,_|\__\___/|_|  \___/ \__,_|\__\___|
```

# MPLS VPN Auto Configuration

This project auto-configures the routers used in a MPLS VPN network.

# Build and install

`npm i`
`npm run build`
`sudo npm i -g .`

# Config file example

```json
{
  "asn": 65000,
  "pCIDR": "10.0.0.0/16",
  "loCIDR": "10.10.10.10/16",
  "providerRouters": [
    {
      "id": "Pescara",
      "telnetHost": "localhost:5002",
      "interfaces": [
        {
          "id": "GigabitEthernet1/0",
          "neighbor": "CEA-1"
        }
      ]
    }
  ],
  "clients": [
    {
      "id": "ClientA",
      "rtNo": 110,
      "routers": [
        {
          "id": "CEA-1",
          "asn": 65002,
          "telnetHost": "localhost:5004",
          "interfaceId": "GigabitEthernet1/0"
        }
      ]
    }
  ]
}
```

# How does it proceed?

## Parsing the config

- Each link between two routers is assigned a /30 subnet, from the range `pCIDR` provided in the config file.
- Each provider router is assigned a loopback IP from the range `loCIDR` provided in the config file.
- Provider Edge routers are marked as such for easier use in the next step.

## Configuring the routers through telnet

### For each provider router:

- set the hostname, enable OSPF
- configure the loopback interface
- if PE:
  - vrf definition for each CE
- for each interface:
  - configure the interface IP address
  - if PE-CE link:
    - vrf forwarding for the CE
  - else:
    - enable OSPF (area 0)
    - enable MPLS
- if PE
  - enable BGP, add every other PE as neighbor
  - for each client:
    - for each CE connected to the PE:
      - address-family ipv4 vrf
      - configure the CE as neighbor

### For each client router:

- set the hostname
- configure the interface connected to the PE
- enable BGP
- add the PE as neighbor

### Done!
