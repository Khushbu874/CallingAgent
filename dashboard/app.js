// Global state
let allCalls = [];
let activeCallId = null;
let pollTimer = null;
let activeLiveCallId = null;

// Initialize Dashboard on Load
document.addEventListener("DOMContentLoaded", () => {
    loadCalls();
    
    const phoneInput = document.getElementById("phone-number");
    if (phoneInput) {
        phoneInput.addEventListener("input", (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
        });
    }

    // Auto poll every 1.5 seconds for real-time live chat updates
    pollTimer = setInterval(() => {
        loadCalls(true);
    }, 1500);
});

// Prefill phone number helper
function prefillNumber(number) {
    const input = document.getElementById("phone-number");
    if (input) {
        input.value = number.replace(/[^0-9]/g, '').slice(0, 10);
    }
}

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

    // UI Dispatching State
    statusBox.classList.remove("hidden");
    statusTitle.textContent = "Dispatching Outbound AI Call...";
    statusDesc.textContent = `Connecting LiveKit Cloud to dial ${countryCode} ${phoneNumber}...`;
    statusBox.style.borderColor = "#6366f1";
    statusBox.style.background = "rgba(99, 102, 241, 0.15)";
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
            statusTitle.textContent = "Connecting Call... 🚀";
            statusDesc.textContent = `Target: ${result.phone_number} | Waiting for caller to pick up...`;
            statusBox.style.borderColor = "#6366f1";
            statusBox.style.background = "rgba(99, 102, 241, 0.15)";
            
            // Auto reload call history immediately
            setTimeout(() => {
                loadCalls(true);
            }, 800);
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

// Fetch and render call history list (isSilent = true avoids full spinner flicker)
async function loadCalls(isSilent = false) {
    const listContainer = document.getElementById("calls-list");
    if (!isSilent && listContainer.children.length === 0) {
        listContainer.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Fetching recorded calls...</div>`;
    }

    try {
        const response = await fetch(`/api/calls?t=${Date.now()}`, { cache: "no-store" });
        const data = await response.json();

        if (data.success) {
            allCalls = data.calls || [];
            renderCallsList(allCalls);

            // Find if there is an active live call
            const liveCall = allCalls.find(c => c.status === "In Progress (Live)" || c.id.startsWith("live_"));
            const statusBox = document.getElementById("call-status");
            const statusTitle = document.getElementById("status-title");
            const statusDesc = document.getElementById("status-desc");

            if (liveCall) {
                // A call is actively live right now
                activeLiveCallId = liveCall.id;
                if (statusBox) {
                    statusBox.classList.remove("hidden");
                    statusTitle.textContent = "Live Call Active 🔴";
                    statusDesc.textContent = `Target: ${liveCall.phone_number} | Real-time speech tracking...`;
                    statusBox.style.borderColor = "#ef4444";
                    statusBox.style.background = "rgba(239, 68, 68, 0.15)";
                }

                // Automatically switch view to the live call so transcripts appear in real-time
                if (activeCallId !== liveCall.id) {
                    activeCallId = liveCall.id;
                    selectCall(liveCall.id, true);
                } else {
                    selectCall(activeCallId, true);
                }
            } else {
                // No live call right now
                if (activeLiveCallId) {
                    // A call WAS live and just completed!
                    activeLiveCallId = null;
                    if (statusBox) {
                        statusTitle.textContent = "Call Completed & Saved 🟢";
                        statusDesc.textContent = "Transcript recording saved successfully!";
                        statusBox.style.borderColor = "#10b981";
                        statusBox.style.background = "rgba(16, 185, 129, 0.15)";
                        setTimeout(() => {
                            statusBox.classList.add("hidden");
                        }, 4000);
                    }
                }

                // Select first completed call if none selected
                if (allCalls.length > 0 && !activeCallId) {
                    activeCallId = allCalls[0].id;
                    selectCall(allCalls[0].id, isSilent);
                } else if (activeCallId) {
                    selectCall(activeCallId, true);
                }
            }
        }
    } catch (err) {
        if (!isSilent) {
            listContainer.innerHTML = `<div class="loading-spinner">Error connecting to server backend.</div>`;
        }
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
        const isLive = call.status === "In Progress (Live)" || call.id.startsWith("live_");
        const formattedDate = call.date || call.timestamp || "Recent Call";
        const msgCount = call.total_messages || (call.conversation ? call.conversation.length : 0);

        const statusBadge = isLive 
            ? `<span class="tag live-tag" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; border-color: rgba(239, 68, 68, 0.4);"><i class="fa-solid fa-circle" style="font-size: 8px; animation: pulse 1s infinite;"></i> LIVE</span>`
            : `<span class="tag" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border-color: rgba(16, 185, 129, 0.3);">Done</span>`;

        return `
            <div class="call-item ${isActive}" onclick="selectCall('${call.id}')">
                <div class="call-item-header">
                    <span class="call-item-phone"><i class="fa-solid fa-phone"></i> ${escapeHtml(call.phone_number)}</span>
                    ${statusBadge}
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
async function selectCall(callId, isSilent = false) {
    activeCallId = callId;

    const chatHeader = document.getElementById("chat-header");
    const chatMessages = document.getElementById("chat-messages");
    const chatPhone = document.getElementById("chat-phone");
    const chatDate = document.getElementById("chat-date");

    if (!isSilent && chatMessages.children.length === 0) {
        chatMessages.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Loading conversation transcript...</div>`;
    }

    try {
        const response = await fetch(`/api/calls/${callId}?t=${Date.now()}`, { cache: "no-store" });
        const data = await response.json();

        if (data.success && data.call) {
            const call = data.call;
            const isLive = call.status === "In Progress (Live)" || call.id.startsWith("live_");

            chatHeader.classList.remove("hidden");
            
            const liveBadge = isLive 
                ? `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4);"><i class="fa-solid fa-circle-dot" style="animation: pulse 1s infinite;"></i> Live Call In Progress</span>`
                : `<span class="badge badge-success"><i class="fa-solid fa-check"></i> Completed</span>`;

            chatPhone.innerHTML = `<i class="fa-solid fa-headset"></i> ${escapeHtml(call.phone_number)}`;
            chatDate.innerHTML = `<i class="fa-regular fa-clock"></i> ${escapeHtml(call.date || call.timestamp || "")} ${liveBadge}`;

            const conversation = call.conversation || [];

            if (conversation.length === 0) {
                chatMessages.innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-comment-slash empty-icon"></i>
                        <h3>Listening for speech...</h3>
                        <p>${isLive ? "Call connected! Transcripts will appear live as speaker talks." : "This call ended with no speech transcripts recorded."}</p>
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

            // Auto scroll chat to bottom on new messages
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    } catch (err) {
        if (!isSilent) {
            chatMessages.innerHTML = `<div class="empty-state"><p>Failed to connect to server.</p></div>`;
        }
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
