import { Req, Res } from '@sapper/internal/manifest-server';


const INTERVAL = 10000;

class DevHandler {
  nonce: string
  clients: Set<Res>;
  interval: ReturnType<typeof setTimeout>;;
  
  constructor(nonce: string, interval: number) {
    this.nonce = nonce;
    this.clients = new Set<Res>();
    this.interval = setInterval(() => {
      this.send(null);
    }, interval);
  }

  handle(req: Req, res: Res, next: () => void) {
    if (req.url !== '/__sapper__') {
      return next()
    }

    req.socket.setKeepAlive(true);
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'Content-Type': 'text/event-stream;charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // While behind nginx, event stream should not be buffered:
      // http://nginx.org/docs/http/ngx_http_proxy_module.html#proxy_buffering
      'X-Accel-Buffering': 'no'
    });

    res.write('\n');

    this._sendClient(res, {nonce: this.nonce})

    this.clients.add(res);
    req.on('close', () => {
      this.clients.delete(res);
    });
  }

  close() {
    clearInterval(this.interval);
  }

  _sendClient(client: Res, data: any) {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  send(data: any) {
    this.clients.forEach(client => {
      this._sendClient(client, data)
    });
  }
}

export function get_dev_handler(interval: number = INTERVAL) {
  const dv = new DevHandler(`${new Date()}`, interval)
  return dv.handle.bind(dv)
}
