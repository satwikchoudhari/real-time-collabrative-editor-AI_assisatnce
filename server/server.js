require("dotenv").config();
const mongoose = require("mongoose");

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB connected"))
.catch((err) => console.error("MongoDB connection error:", err));

const documentSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true },
    content: { type: String, default: "" },
});

const Document = mongoose.model("Document", documentSchema);

const app = express();

app.use(express.static("client"));

app.use((req, res) => {
    res.sendFile(path.join(__dirname, "../client/index.html"));
});

const server = http.createServer(app);
const io = new Server(server);

let roomUsers = {};

io.on("connection", (socket) => {
    console.log("A user connected");

    socket.on("join-room", async ({ roomId, username }) => {

        socket.join(roomId);
        socket.roomId = roomId;
        socket.username = username;

        let document = await Document.findOne({ roomId });

        if (!document) {
            document = await Document.create({ roomId, content: "" });
        }

        if (!roomUsers[roomId]) {
            roomUsers[roomId] = [];
        }

        roomUsers[roomId].push(username);

        socket.emit("code-change", document.content);

        io.to(roomId).emit("user-count", roomUsers[roomId].length);

        socket.to(roomId).emit("user-joined", `${username} joined the room`);

        socket.on("code-change", async (data) => {

            await Document.findOneAndUpdate(
                { roomId },
                { content: data },
                { new: true }
            );

            socket.to(roomId).emit("code-change", data);
        });

    });

    socket.on("disconnect", () => {

        const roomId = socket.roomId;
        const username = socket.username;

        if (roomId && roomUsers[roomId]) {

            roomUsers[roomId] = roomUsers[roomId].filter(
                (user) => user !== username
            );

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