import net from "net"
import { TelnetSocket } from "telnet-stream"

let TSOCK: TelnetSocket | undefined

const defaultCallback = (_: string | Buffer) => {}

let callback = defaultCallback

export async function openTelnet(host: string) {
  const [ip, port] = host.split(":")

  if (TSOCK !== undefined) {
    TSOCK.end()
    TSOCK = undefined
  }

  TSOCK = new TelnetSocket(net.createConnection(parseInt(port), ip))

  TSOCK.on("data", (buffer) => {
    callback(buffer)
  })

  console.log("\n\n------------------------------\n", "CONNECTED TO " + host)

  await c("\u0003", "")
  await c("\u0003", "")
  await c("\u0003", "")
  await c("\u0003", "")
  await new Promise((resolve) => setTimeout(resolve, 2000))
  await c("\r", "")
  await c("\r", "")
  await c("\r", "")
  await c(`en`)
  // await c(`write erase`, "]")
  // await c(`\r`)
  await c(`conf t`)
}

export async function c(cmd: string, waitforchar = "#") {
  // await new Promise((resolve) => setTimeout(resolve, 100))
  console.log(cmd)
  if (!TSOCK) {
    throw new Error("Telnet not connected")
  }

  return new Promise<void>((resolve, reject) => {
    if (!TSOCK) {
      return reject(new Error("Telnet not connected"))
    }

    if (!waitforchar) {
      callback = defaultCallback
    } else {
      callback = (buffer) => {
        const str = buffer.toString("utf8")
        if (str.includes(waitforchar)) {
          // callback = defaultCallback
          return resolve()
        }
      }
    }

    let buf = cmd
    if (buf.toLowerCase() !== buf.toUpperCase()) {
      buf += "\r"
    }
    TSOCK.write(buf)

    if (!waitforchar) {
      resolve()
    }
  })
}
