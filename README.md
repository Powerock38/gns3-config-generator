```
             _                        _
  __ _ _   _| |_ ___  _ __ ___  _   _| |_ ___
 / _` | | | | __/ _ \| '__/ _ \| | | | __/ _ \
| (_| | |_| | || (_) | | | (_) | |_| | ||  __/
 \__,_|\__,_|\__\___/|_|  \___/ \__,_|\__\___|
```

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
      "friends": [],
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

# Usage & features

## Config file

When running the script, you need to provide the path of a config file.

A generated config file will be created in the same directory as the config file you provided, with the same name, but with the `.json` extension replaced with `.generated.json`.

This file will be used to keep the state of the network, and will be used when adding new CEs to the network.

## Adding a new CE

Currently, adding CEs to existing clients is the only network mutation supported.

To add a new CE to an existing client, you need to add to the config file:

- add the new router to the `routers` array of the client
- add a new interface to an existing PE router, with the `neighbor` field set to the new CE's id

You can add as many CEs as you want at once.

## Friends

The `friends` field in the client config is used to specify which clients are friends of the current client. This means that the routers of the current client will be able to reach the routers of the friends, but not the other way around. You specify the friends by adding their client ids to the `friends` array.

# How does it work?

## Parsing the config

- Each link between two routers is assigned a /30 subnet, from the range `pCIDR` provided in the config file.
- Each provider router is assigned a loopback IP from the range `loCIDR` provided in the config file.
- Provider Edge routers are marked as such for easier use in the next step.

## Configuring the routers through telnet

### For each provider router:

- set the hostname, enable OSPF
- configure the loopback interface
- if PE
  - enable BGP
  - add every other PE as neighbor
- for each interface:
  - configure the interface IP address
  - if normal link:
    - enable OSPF (area 0)
    - enable MPLS
  - else if PE-CE link:
    - vrf definition for the CE
      - import and export route target of this client's CE
      - also import route target of friends
    - vrf forwarding for the CE
    - BGP
      - address-family ipv4 vrf
      - configure the CE as neighbor

### For each client router:

- set the hostname
- configure the interface connected to the PE
- enable BGP
- add the PE as neighbor

### Done!
