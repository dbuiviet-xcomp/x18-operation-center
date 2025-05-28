import { Server, Socket } from 'socket.io';

export function initSocket(io: Server) {
  console.log('Initializing Socket.IO handlers');

  io.on('connection', (socket: Socket) => {
    console.log('User connected:', socket.id, 'IP:', socket.handshake.address, 'Query:', socket.handshake.query);

    socket.on('join', (room: string) => {
      console.log(`${socket.id} joining room: ${room}`);
      socket.join(room);
      io.to(room).emit('user-joined', socket.id);
      console.log(`${socket.id} joined room ${room}`);
    });

    socket.on('offer', (data: { sdp: string; type: string; to: string }) => {
      console.log(`Offer from ${socket.id} to ${data.to}:`, { sdp: data.sdp.substring(0, 50) + '...', type: data.type });
      io.to(data.to).emit('offer', { ...data, from: socket.id });
    });

    socket.on('answer', (data: { sdp: string; type: string; to: string }) => {
      console.log(`Answer from ${socket.id} to ${data.to}:`, { sdp: data.sdp.substring(0, 50) + '...', type: data.type });
      io.to(data.to).emit('answer', { ...data, from: socket.id });
    });

    socket.on('ice-candidate', (data: { candidate: any; sdpMid: string; sdpMLineIndex: number; to: string }) => {
      try {
        // Handle both string and object candidate
        const candidateStr = typeof data.candidate === 'object' && data.candidate.candidate
          ? data.candidate.candidate
          : data.candidate;
        console.log(`ICE candidate from ${socket.id} to ${data.to}:`, {
          candidate: candidateStr,
          sdpMid: data.sdpMid,
          sdpMLineIndex: data.sdpMLineIndex
        });
        io.to(data.to).emit('ice-candidate', {
          candidate: candidateStr,
          sdpMid: data.sdpMid,
          sdpMLineIndex: data.sdpMLineIndex,
          from: socket.id
        });
      } catch (error) {
        console.error(`Error processing ICE candidate from ${socket.id}:`, error);
      }
    });

    socket.on('end-call', () => {
      console.log(`End call requested by ${socket.id}`);
      socket.broadcast.emit('end-call');
    });

    socket.on('disconnect', (reason) => {
      console.log(`User disconnected: ${socket.id}, reason: ${reason}`);
    });

    socket.on('error', (error) => {
      console.log(`Socket error for ${socket.id}:`, error);
    });

    socket.onAny((event, ...args) => {
      console.log(`Event ${event} from ${socket.id}:`, args);
    });
  });

  io.on('connect', () => {
    console.log('Socket.IO server connected');
  });

  io.on('error', (error) => {
    console.log('Socket.IO server error:', error);
  });
}