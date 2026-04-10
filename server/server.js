require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/auth");
const roomRoutes = require("./routes/room");
const executeRoutes = require("./routes/execute");
const Room = require("./models/Room");

mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/collab-editor")
.then(() => console.log("MongoDB connected"))
.catch((err) => console.error("MongoDB connection error:", err));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static("client"));

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/execute", executeRoutes);

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "../client/index.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "../client/auth.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "../client/dashboard.html")));
app.get("/room/:roomId", (req, res) => res.sendFile(path.join(__dirname, "../client/editor.html")));

const server = http.createServer(app);
const io = new Server(server);

let roomUsers = {};

io.on("connection", (socket) => {
    socket.on("join-room", async ({ roomId, username }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        socket.username = username || "Anonymous";
        socket.cursorColor = '#' + Math.floor(Math.random()*16777215).toString(16).padEnd(6, '8');

        let room = await Room.findOne({ roomId });
        if (!room) {
            room = await Room.create({ roomId, name: "Untitled Room", files: [{ name: "main.js", content: "\n" }] });
        }

        if (!roomUsers[roomId]) roomUsers[roomId] = [];
        roomUsers[roomId].push({ username: socket.username, color: socket.cursorColor, id: socket.id });

        let filesObj = {};
        if (room.files && room.files.length > 0) {
            for (let file of room.files) {
                if (file.name) filesObj[file.name] = file.content;
            }
        } else {
            filesObj["main.js"] = "\n";
        }

        socket.emit("room-state", { files: filesObj, language: room.language });
        
        io.to(roomId).emit("user-count", roomUsers[roomId].length);
        io.to(roomId).emit("users-list", roomUsers[roomId].map(u => u.username));
        socket.to(roomId).emit("user-joined", `${socket.username} joined the room`);

        socket.on("code-change", async ({ filename, content }) => {
            let r = await Room.findOne({ roomId });
            if (r) {
                if(!r.files) r.files = [];
                let fileItem = r.files.find(f => f.name === filename);
                if (fileItem) fileItem.content = content;
                else r.files.push({ name: filename, content: content });
                await r.save();
                socket.to(roomId).emit("code-change", { filename, content });
            }
        });

        socket.on("file-created", async (filename) => {
            let r = await Room.findOne({ roomId });
            if (r) {
                if(!r.files) r.files = [];
                if (!r.files.find(f => f.name === filename)) {
                    r.files.push({ name: filename, content: "\n" });
                    await r.save();
                    io.to(roomId).emit("file-created", filename); // Broadcast creation
                }
            }
        });

        socket.on("cursor-change", (data) => {
            socket.to(roomId).volatile.emit("cursor-change", { 
                filename: data.filename,
                position: data.position, 
                username: socket.username, 
                color: socket.cursorColor,
                id: socket.id
            });
        });

        socket.on("language-change", async (ext) => {
            await Room.findOneAndUpdate({ roomId }, { language: ext });
            socket.to(roomId).emit("language-change", ext);
        });

        socket.on("console-output", (output) => {
            socket.to(roomId).emit("console-output", output);
        });
    });

    socket.on("disconnect", () => {
        const roomId = socket.roomId;
        if (roomId && roomUsers[roomId]) {
            roomUsers[roomId] = roomUsers[roomId].filter(u => u.id !== socket.id);
            io.to(roomId).emit("user-count", roomUsers[roomId].length);
            io.to(roomId).emit("users-list", roomUsers[roomId].map(u => u.username));
            io.to(roomId).emit("cursor-remove", socket.id);
            socket.to(roomId).emit("user-left", `${socket.username} left the room`);

            if (roomUsers[roomId].length === 0) {
                delete roomUsers[roomId];
            }
        }
    });
});

server.listen(3000, () => {
    console.log("Server running on port 3000");
});