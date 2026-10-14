function strip(s){ return (s||"").replace(/\/+$/,""); }

class WarehouseError extends Error {
  constructor(status, code, body){ super("Warehouse error "+status); this.status=status; this.code=code; this.body=body; }
}

class WarehouseClient {
  constructor(baseUrl, token, timeoutMs) {
    if (!baseUrl) throw new Error("baseUrl required");
    if (!token) throw new Error("token required");
    this.baseUrl = strip(baseUrl);
    this.token = token;
    this.timeout = timeoutMs || 10000;
  }
  async _req(method, path, body) {
    const url = this.baseUrl + path;
    const ctrl = new AbortController();
    const to = setTimeout(()=>ctrl.abort(), this.timeout);
    let res;
    try {
      const opts = { method, headers: { "team-token": this.token, "Content-Type":"application/json" }, signal: ctrl.signal };
      if (body !== undefined) opts.body = JSON.stringify(body);
      res = await fetch(url, opts);
    } catch(e) {
      clearTimeout(to);
      const err = new WarehouseError(0, "network", String(e));
      throw err;
    }
    clearTimeout(to);
    let parsed = null;
    const txt = await res.text();
    try { parsed = txt ? JSON.parse(txt) : null; } catch(e){ parsed = txt; }
    if (!res.ok && res.status !== 409) {
      // network-style for 0 handled separately
    }
    return { status: res.status, body: parsed };
  }
  // methods
  async getOrders() {
    const { status, body } = await this._req("GET", "/orders");
    if (status < 200 || status >= 300) throw new WarehouseError(status, "http", body);
    return { time: body.time, state: body.state, orders: body.orders || [] };
  }
  async getOrdersByStatus(status) {
    const r = await this.getOrders();
    return r.orders.filter(o=>o.status === status);
  }
  async getRunSummary() {
    const { status, body } = await this._req("GET", "/run");
    if (status < 200 || status >= 300) throw new WarehouseError(status, "http", body);
    return body;
  }
  async reportPicked(orderId, robot, cube) {
    const { status, body } = await this._req("POST", "/orders/"+encodeURIComponent(orderId)+"/picked", { robot, cube });
    if (status === 404) throw new WarehouseError(status, "not_found", body);
    if (status === 409) {
      const err = new WarehouseError(status, "conflict", body);
      err.expected = body && body.expected;
      err.received = body && body.received;
      throw err;
    }
    if (status < 200 || status >= 300) throw new WarehouseError(status, "http", body);
    return body;
  }
  async reportDelivered(orderId, robot) {
    const { status, body } = await this._req("POST", "/orders/"+encodeURIComponent(orderId)+"/delivered", { robot });
    if (status === 404) throw new WarehouseError(status, "not_found", body);
    if (status === 409) {
      const err = new WarehouseError(status, "conflict", body);
      throw err;
    }
    if (status < 200 || status >= 300) throw new WarehouseError(status, "http", body);
    return body;
  }
  async sendTelemetry(poses) {
    try {
      const { status } = await this._req("POST", "/telemetry", { poses });
      return status >= 200 && status < 300;
    } catch(e) { return false; }
  }
}

module.exports = { WarehouseClient, WarehouseError };