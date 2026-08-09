// Global state
let allCalls = [];
let activeCallId = null;

// Initialize Dashboard on Load
document.addEventListener("DOMContentLoaded", () => {
    loadCalls();
});

// Prefill phone number helper
function prefillNumber(number) {
    const input = document.getElementById("phone-number");
    input.value = number.replace(/[^0-9]/g, '').slice(0, 10);
}

// Ensure phone number input only accepts digits and max 10 characters
document.addEventListener("DOMContentLoaded", () => {
    loadCalls();
    
    const phoneInput = document.getElementById("phone-number");
    if (phoneInput) {
        phoneInput.addEventListener("input", (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
        });
    }
});

// Trigger Outbound AI Call
async function triggerCall() {
    const countryCode = document.getElementById("country-code").value;
    const phoneNumber = document.getElementById("phone-number").value.trim().replace(/[^0-9]/g, '');
    const statusBox = document.getElementById("call-status");
    const statusTitle = document.getElementById("status-title");
    const statusDesc = document.getElementById("status-desc");
    const callBtn = document.getElementById("call-btn");

    if (!phoneNumber || phoneNumber.length !== 10) {
        statusBox.classList.remove("hidden");
        statusTitle.textContent = "Invalid Mobile Number";
        statusDesc.textContent = "Please enter an exact 10-digit mobile number (e.g., 9302474642).";
        statusBox.style.borderColor = "#ef4444";
        statusBox.style.background = "rgba(239, 68, 68, 0.15)";
        return;
    }

    // UI Loading State
    statusBox.classList.remove("hidden");
    statusTitle.textContent = "Dispatching Outbound AI Call...";
    statusDesc.textContent = `Connecting LiveKit Cloud to dial ${countryCode} ${phoneNumber}...`;
    callBtn.disabled = true;

    try {
        const response = await fetch("/api/call", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                country_code: countryCode,
                phone_number: phoneNumber
            })
        });

        const result = await response.json();

        if (result.success) {
            statusTitle.textContent = "Call Dispatched Successfully! 🚀";
            statusDesc.textContent = `Target: ${result.phone_number} | Dispatch ID: ${result.dispatch_id}`;
            statusBox.style.borderColor = "#10b981";
            statusBox.style.background = "rgba(16, 185, 129, 0.15)";
            
            // Auto reload call history after 6 seconds to capture new call
            setTimeout(() => {
                loadCalls();
            }, 6000);
        } else {
            statusTitle.textContent = "Call Dispatch Failed";
            statusDesc.textContent = result.error || "Could not connect to LiveKit Gateway.";
            statusBox.style.borderColor = "#ef4444";
            statusBox.style.background = "rgba(239, 68, 68, 0.15)";
        }
    } catch (err) {
        statusTitle.textContent = "Server Connection Error";
        statusDesc.textContent = err.message;
        statusBox.style.borderColor = "#ef4444";
    } finally {
        callBtn.disabled = false;
    }
}

// Fetch and render call history list
async function loadCalls() {
    const listContainer = document.getElementById("calls-list");

    try {
        const response = await fetch(`/api/calls?t=${Date.now()}`, { cache: "no-store" });
        const data = await response.json();

        if (data.success) {
            allCalls = data.calls || [];
            renderCallsList(allCalls);

            // Automatically select first call if available and none selected
            if (allCalls.length > 0 && !activeCallId) {
                selectCall(allCalls[0].id);
            }
        } else {
            listContainer.innerHTML = `<div class="loading-spinner">Failed to load calls: ${data.error}</div>`;
        }
    } catch (err) {
        listContainer.innerHTML = `<div class="loading-spinner">Error connecting to server backend.</div>`;
    }
}

// Render call list items
function renderCallsList(calls) {
    const listContainer = document.getElementById("calls-list");

    if (!calls || calls.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state" style="padding: 20px 10px;">
                <i class="fa-solid fa-folder-open empty-icon" style="font-size: 28px;"></i>
                <p>No call recordings found yet.</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = calls.map(call => {
        const isActive = call.id === activeCallId ? "active" : "";
        const formattedDate = call.date || call.timestamp || "Recent Call";
        const msgCount = call.total_messages || (call.conversation ? call.conversation.length : 0);

        return `
            <div class="call-item ${isActive}" onclick="selectCall('${call.id}')">
                <div class="call-item-header">
                    <span class="call-item-phone"><i class="fa-solid fa-phone"></i> ${escapeHtml(call.phone_number)}</span>
                </div>
                <div class="call-item-meta">
                    <span class="call-item-date"><i class="fa-regular fa-clock"></i> ${escapeHtml(formattedDate)}</span>
                    <span><i class="fa-solid fa-comments"></i> ${msgCount} msgs</span>
                </div>
            </div>
        `;
    }).join("");
}

// Select a call and render its chat transcript
async function selectCall(callId) {
    activeCallId = callId;
    renderCallsList(allCalls); // Update active highlighting

    const chatHeader = document.getElementById("chat-header");
    const chatMessages = document.getElementById("chat-messages");
    const chatPhone = document.getElementById("chat-phone");
    const chatDate = document.getElementById("chat-date");

    chatMessages.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Loading conversation transcript...</div>`;

    try {
        const response = await fetch(`/api/calls/${callId}?t=${Date.now()}`, { cache: "no-store" });
        const data = await response.json();

        if (data.success && data.call) {
            const call = data.call;
            chatHeader.classList.remove("hidden");
            chatPhone.innerHTML = `<i class="fa-solid fa-headset"></i> ${escapeHtml(call.phone_number)}`;
            chatDate.innerHTML = `<i class="fa-regular fa-clock"></i> ${escapeHtml(call.date || call.timestamp || "")}`;

            const conversation = call.conversation || [];

            if (conversation.length === 0) {
                chatMessages.innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-comment-slash empty-icon"></i>
                        <h3>No Speech Recorded</h3>
                        <p>This call ended before any speech transcripts were captured.</p>
                    </div>
                `;
                return;
            }

            // Render two-sided chat bubbles
            chatMessages.innerHTML = conversation.map(msg => {
                const isAI = msg.role === "ai" || msg.role === "assistant";
                const roleClass = isAI ? "ai" : "human";
                const avatarIcon = isAI ? `<i class="fa-solid fa-robot"></i>` : `<i class="fa-solid fa-user"></i>`;
                const senderName = isAI ? "TrinityAI (Voice Assistant)" : "Caller / Human";
                const timeStr = msg.timestamp || "";

                return `
                    <div class="chat-bubble-wrapper ${roleClass}">
                        <div class="avatar ${roleClass}">
                            ${avatarIcon}
                        </div>
                        <div class="chat-bubble">
                            <div class="bubble-text">${escapeHtml(msg.text)}</div>
                            <div class="bubble-meta">
                                <span>${senderName}</span>
                                <span>${timeStr}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join("");

            // Auto scroll chat to bottom
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } else {
            chatMessages.innerHTML = `<div class="empty-state"><p>Error loading transcript: ${data.error}</p></div>`;
        }
    } catch (err) {
        chatMessages.innerHTML = `<div class="empty-state"><p>Failed to connect to server.</p></div>`;
    }
}

// Client side search filter
function filterCalls() {
    const query = document.getElementById("search-input").value.toLowerCase().trim();
    if (!query) {
        renderCallsList(allCalls);
        return;
    }

    const filtered = allCalls.filter(call => {
        const phone = (call.phone_number || "").toLowerCase();
        const date = (call.date || call.timestamp || "").toLowerCase();
        const textMatch = call.conversation ? call.conversation.some(c => (c.text || "").toLowerCase().includes(query)) : false;
        return phone.includes(query) || date.includes(query) || textMatch;
    });

    renderCallsList(filtered);
}

// Helper to escape HTML characters
function escapeHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
