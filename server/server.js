const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const DATA_FILE = path.join(__dirname, "documents.json");

const app = express();

app.use(express.static("client"));

app.use((req, res) => {
    res.sendFile(path.join(__dirname, "../client/index.html"));
});

const server = http.createServer(app);
const io = new Server(server);

let documentContent = "";

let documents = {};

let roomUsers = {};

if (fs.existsSync(DATA_FILE)) {
    const fileData = fs.readFileSync(DATA_FILE, "utf-8");
    documents = JSON.parse(fileData);
}

io.on("connection", (socket) => {
    console.log("A user connected");

    socket.on("join-room", ({ roomId, username }) => {
        socket.join(roomId);

        socket.roomId = roomId;
        socket.username = username;

        if (!documents[roomId]) {
            documents[roomId] = "";
        }

        if (!roomUsers[roomId]) {
            roomUsers[roomId] = [];
        }

        roomUsers[roomId].push(username);

        socket.emit("code-change", documents[roomId]);

        io.to(roomId).emit("user-count", roomUsers[roomId].length);

        socket.to(roomId).emit("user-joined", `${username} joined the room`);

        socket.on("code-change", (data) => {
            documents[roomId] = data;

            fs.writeFileSync(DATA_FILE, JSON.stringify(documents, null, 2));

            socket.to(roomId).emit("code-change", data);
        });
    });

    socket.on("disconnect", () => {
        const roomId = socket.roomId;
        const username = socket.username;

        if (roomId && roomUsers[roomId]) {
            roomUsers[roomId] = roomUsers[roomId].filter((user) => user !== username);

            io.to(roomId).emit("user-count", roomUsers[roomId].length);
            socket.to(roomId).emit("user-left", `${username} left the room`);

            if (roomUsers[roomId].length === 0) {
                delete roomUsers[roomId];
            }   
        }
        console.log("A user disconnected");
    });
});

server.listen(3000, () => {
    console.log("Server running on port 3000");
});

