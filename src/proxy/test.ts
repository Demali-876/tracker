import { Socket } from 'node:net';

const socket = new Socket();

socket.connect(5001, 'tracker-proxy.fly.dev', () => {
  console.log('Connected!');
  
  // Add a small delay to ensure connection is stable
  setTimeout(() => {
    const testPacket = '*HQ,123456789012345,V1,123456,A,4045.1234,N,07359.5678,W,0.5,180.0#';
    socket.write(testPacket);
    console.log('Sent:', testPacket);
  }, 100);
});

socket.on('data', (data) => {
  console.log('ACK:', data.toString());
  socket.end();
});

socket.on('error', (err) => console.error('Error:', err.message));
socket.on('close', () => console.log('Closed'));

// Keep connection alive for a bit
setTimeout(() => {
  console.log('Timeout - closing');
  socket.end();
}, 5000);