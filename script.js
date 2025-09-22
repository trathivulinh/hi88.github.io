```javascript
document.addEventListener('DOMContentLoaded', () => {
    const localVideo = document.getElementById('localVideo');
    const remoteVideosDiv = document.getElementById('remoteVideos');
    const chatMessagesDiv = document.getElementById('chatMessages');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const viewerCountSpan = document.getElementById('viewerCount');

    let localStream; // Luồng video/âm thanh từ camera của bạn
    let peerConnections = {}; // Đối tượng để lưu trữ các kết nối WebRTC với người xem khác
    let socket; // Kết nối WebSocket với server

    // --- Khởi tạo WebSocket kết nối đến server ---
    // (Bạn cần có một backend server để xử lý các kết nối WebSocket và WebRTC signaling)
    function initializeWebSocket() {
        // Thay đổi URL này thành địa chỉ server WebSocket của bạn
        socket = new WebSocket('ws://localhost:8080'); // Ví dụ: ws://your-backend-server.com/ws

        socket.onopen = (event) => {
            console.log('Kết nối WebSocket đã mở:', event);
            // Gửi thông tin người dùng lên server (ví dụ: là người phát sóng)
            socket.send(JSON.stringify({ type: 'join', role: 'broadcaster' }));
        };

        socket.onmessage = async (event) => {
            const message = JSON.parse(event.data);

            switch (message.type) {
                case 'offer':
                    // Xử lý offer từ người xem mới (WebRTC signaling)
                    console.log('Nhận offer từ:', message.from);
                    await handleOffer(message);
                    break;
                case 'answer':
                    // Xử lý answer từ người xem (nếu bạn cũng là người xem)
                    console.log('Nhận answer từ:', message.from);
                    await handleAnswer(message);
                    break;
                case 'candidate':
                    // Xử lý ICE candidate (WebRTC signaling)
                    console.log('Nhận ICE candidate từ:', message.from);
                    await handleCandidate(message);
                    break;
                case 'chat_message':
                    // Hiển thị tin nhắn chat
                    addChatMessage(message.sender, message.text);
                    break;
                case 'viewer_count':
                    // Cập nhật số lượng người xem
                    viewerCountSpan.textContent = message.count;
                    break;
                case 'new_viewer':
                    // Một người xem mới đã tham gia, tạo PeerConnection cho họ
                    console.log('Người xem mới tham gia:', message.viewerId);
                    createPeerConnection(message.viewerId, true); // True vì đây là broadcaster, cần gửi stream
                    break;
                case 'viewer_left':
                    // Một người xem đã rời đi
                    console.log('Người xem đã rời đi:', message.viewerId);
                    if (peerConnections[message.viewerId]) {
                        peerConnections[message.viewerId].close();
                        delete peerConnections[message.viewerId];
                        // Xóa video của người xem khỏi DOM nếu có
                        const videoToRemove = document.getElementById(`remoteVideo-${message.viewerId}`);
                        if (videoToRemove) {
                            videoToRemove.remove();
                        }
                    }
                    break;
                default:
                    console.log('Tin nhắn không xác định:', message);
            }
        };

        socket.onclose = (event) => {
            console.log('Kết nối WebSocket đã đóng:', event);
            // Cố gắng kết nối lại sau một khoảng thời gian
            setTimeout(initializeWebSocket, 3000);
        };

        socket.onerror = (error) => {
            console.error('Lỗi WebSocket:', error);
        };
    }

    // --- Lấy luồng video/âm thanh từ camera và mic của người dùng ---
    async function getLocalMediaStream() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            console.log('Đã lấy được luồng media cục bộ.');
        } catch (error) {
            console.error('Không thể truy cập camera/micro:', error);
            alert('Vui lòng cho phép truy cập camera và micro để phát trực tiếp.');
        }
    }

    // --- Tạo kết nối WebRTC PeerConnection ---
    async function createPeerConnection(viewerId, isBroadcaster = false) {
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }, // STUN server để tìm địa chỉ IP công cộng
                // Bạn có thể thêm TURN server nếu cần truyền tải xuyên qua NAT phức tạp hơn
            ]
        });
        peerConnections[viewerId] = peerConnection;

        // Xử lý khi nhận được ICE candidate
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Gửi ICE candidate đến server cho', viewerId);
                socket.send(JSON.stringify({
                    type: 'candidate',
                    candidate: event.candidate,
                    to: viewerId // Gửi đến người xem cụ thể
                }));
            }
        };

        // Xử lý khi nhận được luồng media từ phía đối diện (người xem gửi nếu là P2P)
        peerConnection.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                console.log('Nhận được remote stream từ', viewerId);
                const remoteVideo = document.createElement('video');
                remoteVideo.id = `remoteVideo-${viewerId}`;
                remoteVideo.autoplay = true;
                remoteVideo.srcObject = event.streams[0];
                remoteVideosDiv.appendChild(remoteVideo);
            }
        };

        // Nếu là người phát, thêm luồng cục bộ vào PeerConnection
        if (isBroadcaster && localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
            console.log('Đã thêm local stream vào PeerConnection cho', viewerId);
        }

        // Tạo offer cho người xem mới nếu đây là broadcaster
        if (isBroadcaster) {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            console.log('Gửi offer đến server cho', viewerId);
            socket.send(JSON.stringify({
                type: 'offer',
                sdp: peerConnection.localDescription,
                to: viewerId
            }));
        }

        return peerConnection;
    }

    // --- Xử lý Offer từ người xem (broadcaster nhận) ---
    async function handleOffer(message) {
        let peerConnection = peerConnections[message.from];
        if (!peerConnection) {
            peerConnection = await createPeerConnection(message.from, true); // Người phát tạo PC cho người xem
        }

        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.send(JSON.stringify({
            type: 'answer',
            sdp: peerConnection.localDescription,
            to: message.from
        }));
    }

    // --- Xử lý Answer từ người phát (viewer nhận) ---
    async function handleAnswer(message) {
        const peerConnection = peerConnections[message.from];
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
        }
    }

    // --- Xử lý ICE Candidate ---
    async function handleCandidate(message) {
        const peerConnection = peerConnections[message.from];
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
    }

    // --- Xử lý chat ---
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (message) {
            // Gửi tin nhắn chat qua WebSocket đến server
            socket.send(JSON.stringify({
                type: 'chat_message',
                sender: 'Người phát', // Hoặc tên người dùng thực tế
                text: message
            }));
            chatInput.value = '';
        }
    });

    function addChatMessage(sender, text) {
        const p = document.createElement('p');
        p.innerHTML = `<strong>${sender}:</strong> ${text}`;
        chatMessagesDiv.appendChild(p);
        chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight; // Cuộn xuống cuối
    }

    // --- Khởi động ứng dụng ---
    async function startBroadcasting() {
        await getLocalMediaStream();
        initializeWebSocket();
        // Server sẽ thông báo cho các người xem mới về broadcaster này
    }

    // Gọi hàm này để bắt đầu phát sóng khi trang được tải
    startBroadcasting();
});
```
