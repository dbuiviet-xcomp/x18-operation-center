import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { Server } from 'socket.io';
import { initSocket } from './call_server';

const app = new Hono();
const port = 4000;

console.log(`Starting server on port ${port}`);

app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  console.log(`HTTP: ${c.req.method} ${url.pathname}${url.search}`);
  if (url.pathname.startsWith('/socket.io/')) {
    console.log(`Bypassing Hono: ${url.pathname}${url.search}`);
    return;
  }
  await next();
});

app.get('/', (c) => {
  console.log('Serving UI');
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>X18 Operation Center</title>
      <script src="/socket.io/socket.io.js"></script>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 20px;
          background-color: #f4f4f4;
        }
        #callStatus {
          margin-top: 20px;
          font-weight: bold;
        }
        button {
          padding: 10px 20px;
          margin: 5px;
          cursor: pointer;
          border: none;
          border-radius: 5px;
          background-color: #007bff;
          color: white;
        }
        button:disabled {
          background-color: #cccccc;
          cursor: not-allowed;
        }
      </style>
    </head>
    <body>
      <h1>X18 Operation Center</h1>
      <div id="callStatus">No active call</div>
      <div>
        <button id="muteButton" disabled>Mute</button>
        <button id="endCallButton" disabled>End Call</button>
      </div>
      <script>
        const urlParams = new URLSearchParams(window.location.search);
        const role = urlParams.get('role') || 'operation_center';
        console.log('Role:', role);
        const socket = io({ 
          query: { role }, 
          transports: ['websocket', 'polling'],
          pingTimeout: 30000,
          pingInterval: 10000,
          upgradeTimeout: 20000,
          forceNew: false
        });
        let peerConnection;
        let localStream;
        const configuration = {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            // Uncomment after setting up Coturn
            // { urls: 'turn:127.0.0.1:3456', username: 'user', credential: 'testpass' }
          ]
        };

        // UI elements
        const callStatus = document.getElementById('callStatus');
        const muteButton = document.getElementById('muteButton');
        const endCallButton = document.getElementById('endCallButton');

        // Socket.IO events
        socket.on('connect', () => {
          console.log('Connected to signaling server, socket ID:', socket.id);
          socket.emit('join', 'operation_center');
          callStatus.textContent = 'Waiting for call...';
        });

        socket.on('connect_error', (error) => {
          console.log('Connect error:', error);
          callStatus.textContent = 'Connection failed';
        });

        socket.on('offer', async (data) => {
          console.log('Received offer from:', data.from, 'SDP:', data.sdp.substring(0, 50) + '...');
          callStatus.textContent = 'Connecting...';

          peerConnection = new RTCPeerConnection(configuration);
          setupPeerConnection();

          // Set remote description
          try {
            await peerConnection.setRemoteDescription(
              new RTCSessionDescription({ sdp: data.sdp, type: data.type })
            );
            console.log('Set remote description');
          } catch (e) {
            console.error('Error setting remote description:', e);
            callStatus.textContent = 'Call failed';
            return;
          }

          // Get local audio stream
          try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            localStream.getTracks().forEach((track) => {
              peerConnection.addTrack(track, localStream);
              console.log('Added track:', track.kind);
            });
          } catch (e) {
            console.error('Error getting local audio stream:', e);
            callStatus.textContent = 'Media failed';
            endCall();
            return;
          }

          // Create and send answer
          try {
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            console.log('Answer SDP:', answer.sdp.substring(0, 50) + '...');
            socket.emit('answer', {
              sdp: answer.sdp,
              type: answer.type,
              to: data.from
            });
          } catch (e) {
            console.error('Error creating answer:', e);
            callStatus.textContent = 'Call failed';
            endCall();
            return;
          }
        });

        socket.on('answer', async (data) => {
          console.log('Received answer, SDP:', data.sdp.substring(0, 50) + '...');
          try {
            await peerConnection.setRemoteDescription(
              new RTCSessionDescription({ sdp: data.sdp, type: data.type })
            );
            console.log('Set remote answer');
          } catch (e) {
            console.error('Error setting remote answer:', e);
          }
        });

        socket.on('ice-candidate', async (data) => {
          console.log('Received ICE candidate:', data.candidate);
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate({
              candidate: data.candidate,
              sdpMid: data.sdpMid,
              sdpMLineIndex: data.sdpMLineIndex
            }));
            console.log('Added ICE candidate');
          } catch (e) {
            console.error('Error adding ICE candidate:', e);
          }
        });

        socket.on('end-call', () => {
          console.log('Remote ended call');
          endCall();
        });

        // Peer connection setup
        function setupPeerConnection() {
          peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
              console.log('Sending ICE candidate:', event.candidate.candidate);
              socket.emit('ice-candidate', {
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
                to: 'fleet'
              });
            } else {
              console.log('ICE candidate gathering complete');
            }
          };

          peerConnection.ontrack = (event) => {
            console.log('Received remote audio stream, tracks:', event.streams[0].getTracks().length);
            callStatus.textContent = 'Call connected';
            muteButton.disabled = false;
            endCallButton.disabled = false;
            const audio = document.createElement('audio');
            audio.srcObject = event.streams[0];
            audio.autoplay = true;
            document.body.appendChild(audio);
          };

          peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE state:', peerConnection.iceConnectionState);
            if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
              callStatus.textContent = 'Call connected';
              muteButton.disabled = false;
              endCallButton.disabled = false;
            } else if (peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'disconnected') {
              callStatus.textContent = 'Call failed';
              endCall();
            }
          };

          peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', peerConnection.connectionState);
          };
        }

        // Mute button
        let isMuted = false;
        muteButton.onclick = () => {
          isMuted = !isMuted;
          if (localStream) {
            localStream.getAudioTracks().forEach((track) => {
              track.enabled = !isMuted;
            });
          }
          muteButton.textContent = isMuted ? 'Unmute' : 'Mute';
        };

        // End call
        endCallButton.onclick = endCall;

        function endCall() {
          if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
          }
          if (localStream) {
            localStream.getTracks().forEach((track) => track.stop());
            localStream = null;
          }
          callStatus.textContent = 'No active call';
          muteButton.disabled = true;
          endCallButton.disabled = true;
          muteButton.textContent = 'Mute';
          isMuted = false;
          socket.emit('end-call');
          const audios = document.getElementsByTagName('audio');
          for (let audio of audios) audio.remove();
        }
      </script>
    </body>
    </html>
  `);
});

const server = serve({
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0',
});

const io = new Server(server, {
  path: '/socket.io/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingTimeout: 30000,
  pingInterval: 10000,
  upgradeTimeout: 20000
});

initSocket(io);

io.engine.on('connection', (socket) => {
  const ip = socket.request?.connection?.remoteAddress || socket.remoteAddress || 'unknown';
  console.log('Engine.IO connection:', socket.id, 'IP:', ip);
});

io.engine.on('connection_error', (err) => {
  console.log('Engine.IO error:', err.message, 'Details:', err);
});

console.log(`Socket.IO initialized on /socket.io`);
console.log(`Server running on port ${port}`);