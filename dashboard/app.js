// Global state
let allCalls = [];
let activeCallId = null;
let pollTimer = null;
let activeLiveCallId = null;

// Transliterates non-Latin scripts (Arabic, Urdu, Devanagari) to Roman English letters
function toRomanEnglish(text) {
    if (!text || typeof text !== "string") return text || "";
    
    // Detect ALL non-Latin unicode scripts: Arabic/Urdu, Devanagari, CJK (Chinese/Japanese/Korean), Thai, etc.
    const hasNonLatin = /[\u0250-\uFFFF]/.test(text);
    if (!hasNonLatin) return text;

    const charMap = {
        // Arabic / Urdu script to Roman English mapping
        'ا': 'a', 'آ': 'aa', 'ب': 'b', 'پ': 'p', 'ت': 't', 'ٹ': 't', 'ث': 's', 'ج': 'j', 'چ': 'ch',
        'ح': 'h', 'خ': 'kh', 'د': 'd', 'ڈ': 'd', 'ذ': 'z', 'ر': 'r', 'ڑ': 'r', 'ز': 'z', 'ژ': 'zh',
        'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'z', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f',
        'ق': 'q', 'ک': 'k', 'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ں': 'n', 'و': 'o', 'ہ': 'h',
        'ھ': 'h', 'ی': 'y', 'ے': 'ey', 'ۓ': 'y', 'ۃ': 'h', '؟': '?', '۔': '.',

        // Devanagari script to Roman English mapping
        'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai',
        'ओ': 'o', 'औ': 'au', 'अं': 'an', 'अः': 'ah', 'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh',
        'ङ': 'ng', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny', 'ट': 't', 'ठ': 'th',
        'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
        'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l',
        'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h', 'ा': 'a', 'ि': 'i', 'ी': 'ee',
        'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ं': 'n',
        'ः': 'h', '्': '', '।': '.'
    };

    let result = "";
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (charMap[char] !== undefined) {
            result += charMap[char];
        } else {
            // For unrecognised chars (CJK etc.), keep them as-is
            // New transcripts processed by agent.py anyascii won't reach this path
            result += char;
        }
    }
    return result;
}

// Initialize Dashboard on Load
document.addEventListener("DOMContentLoaded", () => {
    loadCalls();
    
    const phoneInput = document.getElementById("phone-number");
    if (phoneInput) {
        phoneInput.addEventListener("input", (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
        });
    }

    // Auto poll every 2.5 seconds for real-time live chat updates
    pollTimer = setInterval(() => {
        loadCalls(true);
    }, 2500);
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
                    activeCallId = allCalls.length > 0 ? allCalls[0].id : null;
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

                // Ensure activeCallId points to a valid call in allCalls list
                const activeExists = allCalls.some(c => c.id === activeCallId);
                if (!activeExists && allCalls.length > 0) {
                    activeCallId = allCalls[0].id;
                    selectCall(allCalls[0].id, isSilent);
                } else if (allCalls.length > 0 && !activeCallId) {
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

        const deleteBtn = !isLive ? `<button class="item-delete-btn" onclick="event.stopPropagation(); deleteCurrentCall('${call.id}');" title="Delete Call Recording"><i class="fa-solid fa-trash-can"></i></button>` : ``;

        return `
            <div class="call-item ${isActive}" onclick="selectCall('${call.id}')">
                <div class="call-item-header">
                    <span class="call-item-phone"><i class="fa-solid fa-phone"></i> ${escapeHtml(call.phone_number)}</span>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        ${statusBadge}
                        ${deleteBtn}
                    </div>
                </div>
                <div class="call-item-meta">
                    <span class="call-item-date"><i class="fa-regular fa-clock"></i> ${escapeHtml(formattedDate)}</span>
                    <span><i class="fa-solid fa-comments"></i> ${msgCount} msgs</span>
                </div>
            </div>
        `;
    }).join("");
}

// Mobile View Navigation Helpers
function showChatOnMobile() {
    if (window.innerWidth <= 768) {
        const chatPanel = document.getElementById("chat-panel");
        if (chatPanel) chatPanel.classList.add("active-mobile");
    }
}

function showSidebarOnMobile() {
    if (window.innerWidth <= 768) {
        const chatPanel = document.getElementById("chat-panel");
        if (chatPanel) chatPanel.classList.remove("active-mobile");
    }
}

// Select a call and render its chat transcript
async function selectCall(callId, isSilent = false) {
    activeCallId = callId;
    if (!isSilent) {
        showChatOnMobile();
    }

    const chatHeader = document.getElementById("chat-header");
    const chatMessages = document.getElementById("chat-messages");
    const chatPhone = document.getElementById("chat-phone");
    const chatDate = document.getElementById("chat-date");

    if (!isSilent && chatMessages.children.length === 0) {
        chatMessages.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Loading conversation transcript...</div>`;
    }

    let call = allCalls.find(c => c.id === callId);

    // Fetch from server if not found locally or during explicit user click
    if (!call || !isSilent) {
        try {
            const response = await fetch(`/api/calls/${callId}?t=${Date.now()}`, { cache: "no-store" });
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.call) {
                    call = data.call;
                }
            } else if (response.status === 404) {
                // Call was deleted or does not exist — remove from memory list
                allCalls = allCalls.filter(c => c.id !== callId);
                if (activeCallId === callId) {
                    activeCallId = allCalls.length > 0 ? allCalls[0].id : null;
                }
                renderCallsList(allCalls);
                return;
            }
        } catch (err) {
            console.warn("Call detail fetch notice:", err.message);
            // Fallback to local memory item if available
            call = call || allCalls.find(c => c.id === callId);
        }
    }

    if (call) {
        currentCallData = call;
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

            // ── Smart scroll: capture state BEFORE innerHTML wipes scrollTop ──
            const prevScrollTop = chatMessages.scrollTop;
            const prevScrollHeight = chatMessages.scrollHeight;
            const prevCount = chatMessages.dataset.msgCount ? parseInt(chatMessages.dataset.msgCount) : 0;
            const isNearBottom = prevScrollHeight - prevScrollTop - chatMessages.clientHeight < 80;

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
                            <div class="bubble-text">${escapeHtml(toRomanEnglish(msg.text))}</div>
                            <div class="bubble-meta">
                                <span>${senderName}</span>
                                <span>${timeStr}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join("");

            const newCount = conversation.length;
            chatMessages.dataset.msgCount = newCount;

            if (isNearBottom || newCount > prevCount) {
                // User was near bottom OR new message arrived → scroll to bottom
                chatMessages.scrollTop = chatMessages.scrollHeight;
            } else {
                // User scrolled up to read history → restore their exact position
                const scrollDelta = chatMessages.scrollHeight - prevScrollHeight;
                chatMessages.scrollTop = prevScrollTop + scrollDelta;
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

// Global variable for current active call details
let currentCallData = null;

// Download PDF Transcript Function
function downloadPDF() {
    if (!currentCallData || !currentCallData.conversation || currentCallData.conversation.length === 0) {
        alert("No transcript content available to download as PDF.");
        return;
    }

    const phone = currentCallData.phone_number || "Call";
    const dateStr = currentCallData.date || currentCallData.timestamp || "Transcript";
    const safePhone = phone.replace(/[^0-9]/g, "");

    // Fallback to TXT if html2pdf library is not loaded
    if (typeof html2pdf === "undefined") {
        downloadTranscript();
        return;
    }

    showToast("Generating PDF transcript...");

    // Create container formatted for PDF document
    const pdfElement = document.createElement("div");
    pdfElement.style.padding = "24px 30px";
    pdfElement.style.fontFamily = "'Outfit', sans-serif, Helvetica, Arial";
    pdfElement.style.color = "#0f172a";
    pdfElement.style.background = "#ffffff";

    let conversationHTML = currentCallData.conversation.map(msg => {
        const isAI = msg.role === "ai" || msg.role === "assistant";
        const speaker = isAI ? "TrinityAI (Voice Assistant)" : "Caller / Human";
        const bg = isAI ? "#047857" : "#1e293b";
        const color = "#ffffff";
        const align = isAI ? "left" : "right";

        return `
            <div style="margin-bottom: 16px; text-align: ${align};">
                <div style="font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 4px;">
                    ${speaker} • ${msg.timestamp || ''}
                </div>
                <div style="display: inline-block; padding: 10px 16px; border-radius: 12px; background: ${bg}; color: ${color}; max-width: 80%; text-align: left; font-size: 13px; line-height: 1.5; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    ${escapeHtml(toRomanEnglish(msg.text))}
                </div>
            </div>
        `;
    }).join("");

    pdfElement.innerHTML = `
        <div style="border-bottom: 2px solid #6366f1; padding-bottom: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <h1 style="margin: 0; font-size: 24px; color: #4338ca; font-weight: 700;">Trinity<span style="color: #6366f1;">AI</span> Console</h1>
                <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748b; font-weight: 500;">Official Outbound Voice Call Transcript</p>
            </div>
            <div style="text-align: right; font-size: 12px; color: #334155; line-height: 1.6;">
                <div><strong>Phone Number:</strong> ${escapeHtml(phone)}</div>
                <div><strong>Call Date:</strong> ${escapeHtml(dateStr)}</div>
                <div><strong>Total Messages:</strong> ${currentCallData.conversation.length}</div>
            </div>
        </div>

        <div style="margin-bottom: 24px; min-height: 400px;">
            ${conversationHTML}
        </div>

        <div style="border-top: 1px solid #e2e8f0; padding-top: 14px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #94a3b8;">
            <span>Generated by TrinityAI Solutions</span>
            <span>Call ID: ${escapeHtml(currentCallData.id || '')}</span>
        </div>
    `;

    const opt = {
        margin:       [10, 10, 10, 10],
        filename:     `Transcript_${safePhone}_${dateStr.replace(/[^0-9]/g, "_")}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, logging: false },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(pdfElement).save().then(() => {
        showToast("PDF Transcript downloaded successfully!");
    });
}

// Share PDF Transcript Function
async function shareTranscript() {
    if (!currentCallData || !currentCallData.conversation || currentCallData.conversation.length === 0) {
        alert("No transcript content available to share.");
        return;
    }

    const phone = currentCallData.phone_number || "Call";
    const dateStr = currentCallData.date || currentCallData.timestamp || "Transcript";
    const safePhone = phone.replace(/[^0-9]/g, "");
    const fileName = `Transcript_${safePhone}_${dateStr.replace(/[^0-9]/g, "_")}.pdf`;

    showToast("Preparing PDF file for sharing...");

    // Try sharing actual PDF file if html2pdf is available
    if (typeof html2pdf !== "undefined") {
        try {
            const pdfElement = document.createElement("div");
            pdfElement.style.padding = "24px 30px";
            pdfElement.style.fontFamily = "'Outfit', sans-serif, Helvetica, Arial";
            pdfElement.style.color = "#0f172a";
            pdfElement.style.background = "#ffffff";

            let conversationHTML = currentCallData.conversation.map(msg => {
                const isAI = msg.role === "ai" || msg.role === "assistant";
                const speaker = isAI ? "TrinityAI (Voice Assistant)" : "Caller / Human";
                const bg = isAI ? "#047857" : "#1e293b";
                const color = "#ffffff";
                const align = isAI ? "left" : "right";

                return `
                    <div style="margin-bottom: 16px; text-align: ${align};">
                        <div style="font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 4px;">
                            ${speaker} • ${msg.timestamp || ''}
                        </div>
                        <div style="display: inline-block; padding: 10px 16px; border-radius: 12px; background: ${bg}; color: ${color}; max-width: 80%; text-align: left; font-size: 13px; line-height: 1.5;">
                            ${escapeHtml(msg.text)}
                        </div>
                    </div>
                `;
            }).join("");

            pdfElement.innerHTML = `
                <div style="border-bottom: 2px solid #6366f1; padding-bottom: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h1 style="margin: 0; font-size: 24px; color: #4338ca; font-weight: 700;">Trinity<span style="color: #6366f1;">AI</span> Console</h1>
                        <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748b;">Official Outbound Voice Call Transcript</p>
                    </div>
                    <div style="text-align: right; font-size: 12px; color: #334155;">
                        <div><strong>Phone:</strong> ${escapeHtml(phone)}</div>
                        <div><strong>Date:</strong> ${escapeHtml(dateStr)}</div>
                    </div>
                </div>
                <div style="margin-bottom: 24px;">${conversationHTML}</div>
                <div style="border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 11px; color: #94a3b8;">
                    Generated by TrinityAI Solutions
                </div>
            `;

            const opt = {
                margin:       [10, 10, 10, 10],
                filename:     fileName,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, logging: false },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            const pdfWorker = html2pdf().set(opt).from(pdfElement);
            const pdfBlob = await pdfWorker.output('blob');
            const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: `Call Transcript PDF - ${phone}`,
                    text: `Official Voice Call Transcript PDF for ${phone}`,
                    files: [file]
                });
                showToast("PDF document shared successfully!");
                return;
            }
        } catch (e) {
            console.warn("PDF file share not supported or cancelled:", e);
        }
    }

    // Fallback: Text Share or Copy
    let shareText = `📞 Call Transcript (${phone} - ${dateStr}):\n\n`;
    currentCallData.conversation.forEach((msg) => {
        const isAI = msg.role === "ai" || msg.role === "assistant";
        const speaker = isAI ? "🤖 TrinityAI" : "👤 Caller";
        shareText += `${speaker}: ${toRomanEnglish(msg.text)}\n`;
    });

    if (navigator.share) {
        try {
            await navigator.share({
                title: `Call Transcript - ${phone}`,
                text: shareText
            });
            return;
        } catch (e) {}
    }

    try {
        await navigator.clipboard.writeText(shareText);
        showToast("Transcript text copied to clipboard!");
    } catch (err) {
        alert("Transcript text copied!");
    }
}

// Toast helper
function showToast(message) {
    let toast = document.getElementById("toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        toast.style.position = "fixed";
        toast.style.bottom = "30px";
        toast.style.right = "30px";
        toast.style.background = "linear-gradient(135deg, #059669 0%, #10b981 100%)";
        toast.style.color = "#fff";
        toast.style.padding = "12px 20px";
        toast.style.borderRadius = "8px";
        toast.style.boxShadow = "0 4px 20px rgba(0,0,0,0.4)";
        toast.style.zIndex = "9999";
        toast.style.fontSize = "14px";
        toast.style.fontWeight = "600";
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${message}`;
    toast.style.display = "block";
    setTimeout(() => {
        toast.style.display = "none";
    }, 3500);
}

// Delete Call Recording with SweetAlert2 Modal
async function deleteCurrentCall(targetCallId = null) {
    const callId = targetCallId || activeCallId;
    if (!callId) return;

    const call = allCalls.find(c => c.id === callId);
    const phone = call ? call.phone_number : "this call record";

    // Use SweetAlert2 (loaded locally via sweetalert2.all.min.js)
    if (typeof Swal !== "undefined") {
        const result = await Swal.fire({
            title: "Delete Call Recording?",
            text: `Are you sure you want to permanently delete the transcript recording for ${phone}?`,
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#ef4444",
            cancelButtonColor: "#64748b",
            confirmButtonText: '<i class="fa-solid fa-trash-can"></i> Yes, Delete',
            cancelButtonText: "Cancel",
            customClass: {
                popup: "swal-dark-popup"
            }
        });

        if (!result.isConfirmed) return;
    } else {
        if (!confirm(`Are you sure you want to delete the call recording for ${phone}?`)) {
            return;
        }
    }

    try {
        const response = await fetch(`/api/calls/${callId}`, {
            method: "DELETE"
        });
        const data = await response.json();

        if (data.success) {
            if (typeof Swal !== "undefined") {
                Swal.fire({
                    title: "Deleted!",
                    text: "Call transcript recording has been deleted.",
                    icon: "success",
                    timer: 2000,
                    showConfirmButton: false,
                    customClass: {
                        popup: "swal-dark-popup"
                    }
                });
            } else {
                showToast("Call recording deleted.");
            }

            if (activeCallId === callId) {
                activeCallId = null;
                const chatHeader = document.getElementById("chat-header");
                const chatMessages = document.getElementById("chat-messages");
                if (chatHeader) chatHeader.classList.add("hidden");
                if (chatMessages) {
                    chatMessages.innerHTML = `
                        <div class="empty-state">
                            <i class="fa-solid fa-headset empty-icon"></i>
                            <h3>No Call Selected</h3>
                            <p>Select a call from the left list to view the full two-sided transcript recorded between AI and Human.</p>
                        </div>
                    `;
                }
            }
            loadCalls();
        } else {
            if (typeof Swal !== "undefined") {
                Swal.fire({
                    title: "Error!",
                    text: data.error || "Failed to delete call recording.",
                    icon: "error",
                    customClass: {
                        popup: "swal-dark-popup"
                    }
                });
            }
        }
    } catch (err) {
        if (typeof Swal !== "undefined") {
            Swal.fire({
                title: "Server Error",
                text: err.message,
                icon: "error",
                customClass: {
                    popup: "swal-dark-popup"
                }
            });
        }
    }
}
