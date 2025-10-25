"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
var node_net_1 = require("node:net");
var PORT = Number((_a = process.env.PORT) !== null && _a !== void 0 ? _a : 5001);
var server = (0, node_net_1.createServer)();
server.on("connection", function (socket) {
    var r = "".concat(socket.remoteAddress, ":").concat(socket.remotePort);
    console.log("CONNECTED <- ".concat(r));
    socket.on("data", function (buf) {
        console.log("DATA (".concat(r, ") bytes=").concat(buf.length));
        console.log("  utf8:", buf.toString("utf8"));
        console.log("  hex :", buf.toString("hex"));
    });
    socket.on("close", function () { return console.log("CLOSED   <- ".concat(r)); });
    socket.on("error", function (e) { return console.error("ERROR (".concat(r, ")"), e.message); });
});
server.listen(PORT, function () {
    console.log("LISTENING on port ".concat(PORT));
});
