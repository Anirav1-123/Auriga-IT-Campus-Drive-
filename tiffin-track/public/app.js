const API = "/api";

let token = localStorage.getItem("token");
let isRegister = false;

let currentPage = 1;
let totalPages = 1;

let currentCustomerId = null;
let currentCustomer = null;


/* =========================================================
   PAGE LOAD
========================================================= */

window.onload = function () {

    loadTheme();

    if (token) {

        showDashboard();

        loadDashboard();

        loadCustomers();

        loadApplicationClock();

    } else {

        showLanding();

    }

};


/* =========================================================
   BASIC SCREEN NAVIGATION
========================================================= */

function showLanding() {

    document.getElementById("landing").classList.remove("hidden");
    document.getElementById("auth").classList.add("hidden");
    document.getElementById("dashboard").classList.add("hidden");

}


function showLogin() {

    isRegister = false;

    document.getElementById("landing").classList.add("hidden");
    document.getElementById("auth").classList.remove("hidden");
    document.getElementById("dashboard").classList.add("hidden");

    document.getElementById("authTitle").innerText = "Login";

    document.getElementById("name").style.display = "none";

    document.getElementById("toggleButton").innerText =
        "Don't have an account? Register";

    document.getElementById("message").innerText = "";

}


function showRegister() {

    isRegister = true;

    document.getElementById("landing").classList.add("hidden");
    document.getElementById("auth").classList.remove("hidden");
    document.getElementById("dashboard").classList.add("hidden");

    document.getElementById("authTitle").innerText =
        "Create Account";

    document.getElementById("name").style.display = "block";

    document.getElementById("toggleButton").innerText =
        "Already have an account? Login";

    document.getElementById("message").innerText = "";

}


function toggleAuth() {

    if (isRegister) {

        showLogin();

    } else {

        showRegister();

    }

}


function showDashboard() {

    document.getElementById("landing").classList.add("hidden");
    document.getElementById("auth").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");

}


/* =========================================================
   AUTHENTICATION
========================================================= */

async function submitAuth() {

    const name =
        document.getElementById("name").value.trim();

    const email =
        document.getElementById("email").value.trim();

    const password =
        document.getElementById("password").value;

    const message =
        document.getElementById("message");


    if (isRegister && name.length < 2) {

        message.innerText =
            "Please enter your name.";

        return;

    }


    if (!email || !email.includes("@")) {

        message.innerText =
            "Please enter a valid email.";

        return;

    }


    if (password.length < 6) {

        message.innerText =
            "Password must be at least 6 characters.";

        return;

    }


    const endpoint =
        isRegister
            ? "/auth/register"
            : "/auth/login";


    const body =
        isRegister
            ? {
                name,
                email,
                password
            }
            : {
                email,
                password
            };


    try {

        const response =
            await fetch(
                API + endpoint,
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify(body)
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            message.innerText =
                data.message ||
                "Something went wrong.";

            return;

        }


        if (isRegister) {

            showLogin();

            document.getElementById("email").value =
                email;

            document.getElementById("password").value =
                "";

            document.getElementById("message").innerText =
                "Account created successfully. Please login.";

            return;

        }


        token =
            data.token;

        localStorage.setItem(
            "token",
            token
        );


        showDashboard();

        loadDashboard();

        loadCustomers();

        loadApplicationClock();

    } catch (error) {

        console.log(error);

        message.innerText =
            "Server connection failed.";

    }

}


/* =========================================================
   API HELPER
========================================================= */

async function api(url, options = {}) {

    options.headers =
        options.headers || {};


    if (!options.body ||
        !(options.body instanceof FormData)) {

        options.headers["Content-Type"] =
            "application/json";

    }


    if (token) {

        options.headers["Authorization"] =
            `Bearer ${token}`;

    }


    const response =
        await fetch(
            API + url,
            options
        );


    if (response.status === 401) {

        logout();

        return null;

    }


    return response;

}


/* =========================================================
   DASHBOARD
========================================================= */

async function loadDashboard() {

    try {

        const response =
            await api("/dashboard");


        if (!response) return;


        const data =
            await response.json();


        document.getElementById("total").innerText =
            data.totalCustomers || 0;


        document.getElementById("active").innerText =
            data.activeCustomers || 0;


        document.getElementById("paused").innerText =
            data.pausedCustomers || 0;


        document.getElementById("todayServed").innerText =
            data.todayServed || 0;


        document.getElementById("totalRevenue").innerText =
            "₹" +
            Number(
                data.totalRevenue || 0
            ).toFixed(0);

    } catch (error) {

        console.log(error);

    }

}


/* =========================================================
   APPLICATION CLOCK — T1
========================================================= */

async function loadApplicationClock() {

    const element =
        document.getElementById(
            "applicationClock"
        );


    if (!element) return;


    element.innerText =
        "Loading...";


    try {

        const response =
            await fetch(
                "/clock"
            );


        if (!response.ok) {

            element.innerText =
                new Date()
                    .toISOString()
                    .slice(0, 10);

            return;

        }


        const data =
            await response.json();


        element.innerText =
            data.clock ||
            data.date ||
            new Date()
                .toISOString()
                .slice(0, 10);

    } catch (error) {

        element.innerText =
            new Date()
                .toISOString()
                .slice(0, 10);

    }

}


/*
   Run POST /clock.

   The current date is sent unless a date is supplied.
*/

async function runMorningNotifications(date = null) {

    try {

        if (!date) {

            date =
                new Date()
                    .toISOString()
                    .slice(0, 10);

        }


        const response =
            await fetch(
                "/clock",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        date
                    })
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            showMessage(
                data.message ||
                "Unable to run notifications."
            );

            return;

        }


        loadApplicationClock();


        const notification =
            data.notification || {};


        showMessage(
            "Notification Service completed.\n\n" +
            "Date: " +
            (notification.date || date) +
            "\n" +
            "Customers due: " +
            (notification.dueCustomers || 0) +
            "\n" +
            "Notified: " +
            (notification.notified || 0)
        );


    } catch (error) {

        console.log(error);

        showMessage(
            "Unable to run today's notifications."
        );

    }

}


/* =========================================================
   NOTIFICATION OUTBOX — T1
========================================================= */

async function openOutbox() {

    const modal =
        document.getElementById(
            "outboxModal"
        );


    if (!modal) return;


    modal.classList.remove("hidden");


    const container =
        document.getElementById(
            "outboxList"
        );


    container.innerHTML =
        "<p>Loading notifications...</p>";


    try {

        const response =
            await fetch(
                "/outbox"
            );


        const data =
            await response.json();


        if (!response.ok) {

            container.innerHTML =
                `<p>
                    ${escapeHtml(
                        data.message ||
                        "Unable to load outbox."
                    )}
                </p>`;

            return;

        }


        const outbox =
            data.outbox || [];


        container.innerHTML = "";


        if (!outbox.length) {

            container.innerHTML =
                "<p>No notifications found.</p>";

            return;

        }


        outbox.forEach(item => {

            container.innerHTML += `

                <div class="outboxItem">

                    <div>

                        <strong>
                            ${escapeHtml(
                                item.phone || ""
                            )}
                        </strong>

                        <p>
                            ${escapeHtml(
                                item.message || ""
                            )}
                        </p>

                    </div>

                    <span>
                        ${escapeHtml(
                            item.status || "PENDING"
                        )}
                    </span>

                </div>

            `;

        });

    } catch (error) {

        console.log(error);

        container.innerHTML =
            "<p>Unable to load notification outbox.</p>";

    }

}


function closeOutbox() {

    document
        .getElementById("outboxModal")
        .classList.add("hidden");

}


/* =========================================================
   CUSTOMER LIST
========================================================= */

async function loadCustomers() {

    try {

        const search =
            document.getElementById("search")
                .value.trim();

        const status =
            document.getElementById("status")
                .value;

        const sort =
            document.getElementById("sort")
                .value;


        const params =
            new URLSearchParams();


        params.append(
            "page",
            currentPage
        );

        params.append(
            "limit",
            5
        );

        params.append(
            "sortBy",
            sort
        );

        params.append(
            "order",
            "asc"
        );


        if (search) {

            params.append(
                "search",
                search
            );

        }


        if (status) {

            params.append(
                "status",
                status
            );

        }


        const response =
            await api(
                "/customers?" +
                params.toString()
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            console.log(
                data.message ||
                "Unable to load customers."
            );

            return;

        }


        renderCustomers(data);

    } catch (error) {

        console.log(error);

    }

}


/* =========================================================
   RENDER CUSTOMERS
========================================================= */

function renderCustomers(data) {

    const container =
        document.getElementById(
            "customers"
        );


    const customers =
        data.customers || [];


    if (data.pagination) {

        totalPages =
            data.pagination.totalPages || 1;

    } else {

        totalPages =
            data.totalPages || 1;

    }


    container.innerHTML = "";


    if (!customers.length) {

        container.innerHTML = `

            <tr>

                <td
                    colspan="5"
                    style="text-align:center;">

                    No customers found.

                </td>

            </tr>

        `;


        updatePageInfo();

        return;

    }


    customers.forEach(customer => {

        const row =
            document.createElement("tr");


        const statusClass =
            customer.status === "ACTIVE"
                ? "activeStatus"
                : "pausedStatus";


        row.innerHTML = `

            <td>

                <strong>
                    ${escapeHtml(
                        customer.name
                    )}
                </strong>

            </td>


            <td>
                ${escapeHtml(
                    customer.phone
                )}
            </td>


            <td>
                ₹${Number(
                    customer.monthly_price || 0
                ).toFixed(0)}
            </td>


            <td>

                <span
                    class="${statusClass}">

                    ${escapeHtml(
                        customer.status
                    )}

                </span>

            </td>


            <td>

                <button
                    class="secondary"
                    onclick="viewCustomer(
                        ${customer.id}
                    )">

                    View

                </button>

            </td>

        `;


        container.appendChild(row);

    });


    updatePageInfo();

}


/* =========================================================
   PAGINATION
========================================================= */

function updatePageInfo() {

    const element =
        document.getElementById(
            "pageInfo"
        );


    if (!element) return;


    element.innerText =
        `Page ${currentPage} of ${totalPages}`;

}


function previousPage() {

    if (currentPage > 1) {

        currentPage--;

        loadCustomers();

    }

}


function nextPage() {

    if (currentPage < totalPages) {

        currentPage++;

        loadCustomers();

    }

}


/* =========================================================
   ADD CUSTOMER
========================================================= */

function openAddCustomer() {

    document
        .getElementById("customerModal")
        .classList.remove("hidden");

}


function closeModal() {

    document
        .getElementById("customerModal")
        .classList.add("hidden");

}


async function addCustomer() {

    const name =
        document.getElementById(
            "customerName"
        ).value.trim();


    const phone =
        document.getElementById(
            "customerPhone"
        ).value.trim();


    const address =
        document.getElementById(
            "customerAddress"
        ).value.trim();


    const price =
        Number(
            document.getElementById(
                "customerPrice"
            ).value
        );


    if (!name || name.length < 2) {

        alert(
            "Enter a valid customer name."
        );

        return;

    }


    if (!/^[6-9]\d{9}$/.test(phone)) {

        alert(
            "Enter a valid 10-digit Indian mobile number."
        );

        return;

    }


    if (!address) {

        alert(
            "Please enter address."
        );

        return;

    }


    if (!price || price <= 0) {

        alert(
            "Enter a valid monthly plan price."
        );

        return;

    }


    try {

        const response =
            await api(
                "/customers",
                {
                    method: "POST",

                    body: JSON.stringify({
                        name,
                        phone,
                        address,
                        monthly_price: price
                    })
                }
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            alert(
                data.message ||
                "Unable to add customer."
            );

            return;

        }


        alert(
            "Customer added successfully."
        );


        document.getElementById(
            "customerName"
        ).value = "";


        document.getElementById(
            "customerPhone"
        ).value = "";


        document.getElementById(
            "customerAddress"
        ).value = "";


        document.getElementById(
            "customerPrice"
        ).value = "";


        closeModal();


        currentPage = 1;

        loadCustomers();

        loadDashboard();

    } catch (error) {

        console.log(error);

        alert(
            "Server error."
        );

    }

}
/* =========================================================
   VIEW CUSTOMER
========================================================= */

async function viewCustomer(id) {

    currentCustomerId = id;


    try {

        const response =
            await api(
                `/customers/${id}`
            );


        if (!response) return;


        const customer =
            await response.json();


        if (!response.ok) {

            alert(
                customer.message ||
                "Customer not found."
            );

            return;

        }


        currentCustomer =
            customer;


        const details =
            document.getElementById(
                "details"
            );


        details.innerHTML = `

            <h2>
                ${escapeHtml(
                    customer.name
                )}
            </h2>


            <div class="customerInfo">

                <p>
                    <strong>📱 Phone:</strong>
                    ${escapeHtml(
                        customer.phone
                    )}
                </p>


                <p>
                    <strong>📍 Address:</strong>
                    ${escapeHtml(
                        customer.address
                    )}
                </p>


                <p>
                    <strong>💰 Monthly Plan:</strong>
                    ₹${Number(
                        customer.monthly_price || 0
                    ).toFixed(0)}
                </p>


                <p>

                    <strong>Status:</strong>

                    ${escapeHtml(
                        customer.status
                    )}

                </p>

            </div>


            <div id="billBox">
                Loading bill...
            </div>


            <div class="detailsActions">

                ${
                    customer.status === "ACTIVE"

                    ? `

                        <button
                            class="secondary"
                            onclick="pauseCustomer(
                                ${customer.id}
                            )">

                            ⏸ Pause

                        </button>

                    `

                    : `

                        <button
                            class="primary"
                            onclick="resumeCustomer(
                                ${customer.id}
                            )">

                            ▶ Resume

                        </button>

                    `
                }


                <button
                    class="secondary"
                    onclick="openPaymentModal(
                        ${customer.id}
                    )">

                    💳 Payment

                </button>


                <button
                    class="secondary"
                    onclick="openPaymentHistory(
                        ${customer.id}
                    )">

                    📜 History

                </button>


                <button
                    class="secondary"
                    onclick="openInvoice(
                        ${customer.id}
                    )">

                    🧾 Invoice

                </button>


                <button
                    class="secondary"
                    onclick="openContact(
                        ${customer.id}
                    )">

                    📞 Contact

                </button>


                <button
                    class="secondary"
                    onclick="openTransferForCustomer(
                        ${customer.id}
                    )">

                    🔄 Transfer

                </button>

            </div>

        `;


        document
            .getElementById("detailsModal")
            .classList.remove("hidden");


        loadBill(id);

    } catch (error) {

        console.log(error);

    }

}


function closeDetails() {

    document
        .getElementById("detailsModal")
        .classList.add("hidden");

}


/* =========================================================
   BILLING
========================================================= */

async function loadBill(id) {

    try {

        const response =
            await api(
                `/customers/${id}/bill`
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            const box =
                document.getElementById(
                    "billBox"
                );


            if (box) {

                box.innerHTML =
                    "Unable to load bill.";

            }

            return;

        }


        const finalBill =
            Number(
                data.finalBill || 0
            );


        const paidAmount =
            Number(
                data.paidAmount || 0
            );


        const balance =
            Number(
                data.balance || 0
            );


        const paymentStatus =
            data.paymentStatus ||
            "PENDING";


        const box =
            document.getElementById(
                "billBox"
            );


        if (!box) return;


        box.innerHTML = `

            <div class="billBox">

                <h3>
                    💰 Current Month Bill
                </h3>


                <div class="billGrid">

                    <div>

                        <span>
                            Monthly Plan
                        </span>

                        <strong>
                            ₹${Number(
                                data.monthlyPlan || 0
                            ).toFixed(0)}
                        </strong>

                    </div>


                    <div>

                        <span>
                            Service Days
                        </span>

                        <strong>
                            ${data.totalServiceDays || 0}
                        </strong>

                    </div>


                    <div>

                        <span>
                            Served Days
                        </span>

                        <strong>
                            ${data.servedDays || 0}
                        </strong>

                    </div>


                    <div>

                        <span>
                            Paused Days
                        </span>

                        <strong>
                            ${data.pausedDays || 0}
                        </strong>

                    </div>


                    <div>

                        <span>
                            Daily Rate
                        </span>

                        <strong>
                            ₹${Number(
                                data.dailyRate || 0
                            ).toFixed(2)}
                        </strong>

                    </div>


                    <div>

                        <span>
                            Total Bill
                        </span>

                        <strong>
                            ₹${finalBill.toFixed(2)}
                        </strong>

                    </div>


                    <div>

                        <span>
                            Paid
                        </span>

                        <strong>
                            ₹${paidAmount.toFixed(2)}
                        </strong>

                    </div>


                    <div>

                        <span>
                            Balance
                        </span>

                        <strong>
                            ₹${balance.toFixed(2)}
                        </strong>

                    </div>

                </div>


                <div class="paymentStatus">

                    Payment Status:

                    <strong>
                        ${escapeHtml(
                            paymentStatus
                        )}
                    </strong>

                </div>

            </div>

        `;

    } catch (error) {

        console.log(error);

    }

}


/* =========================================================
   PAUSE / RESUME
========================================================= */

async function pauseCustomer(id) {

    const confirmed =
        confirm(
            "Pause this customer's tiffin service?"
        );


    if (!confirmed) return;


    try {

        const response =
            await api(
                `/customers/${id}/pause`,
                {
                    method: "POST"
                }
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            alert(
                data.message ||
                "Unable to pause customer."
            );

            return;

        }


        alert(
            "Customer paused."
        );


        closeDetails();

        loadCustomers();

        loadDashboard();

    } catch (error) {

        alert(
            "Server error."
        );

    }

}


async function resumeCustomer(id) {

    try {

        const response =
            await api(
                `/customers/${id}/resume`,
                {
                    method: "POST"
                }
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            alert(
                data.message ||
                "Unable to resume customer."
            );

            return;

        }


        alert(
            "Customer resumed."
        );


        closeDetails();

        loadCustomers();

        loadDashboard();

    } catch (error) {

        alert(
            "Server error."
        );

    }

}


/* =========================================================
   T6 — TRANSFER SUBSCRIPTION
========================================================= */

async function openTransferForCustomer(customerId) {

    try {

        const response =
            await api(
                `/customers/${customerId}`
            );


        if (!response) return;


        const customer =
            await response.json();


        if (!response.ok) {

            alert(
                customer.message ||
                "Unable to load customer."
            );

            return;

        }


        currentCustomer =
            customer;

        currentCustomerId =
            customerId;


        /*
           Try to use subscription id supplied
           by customer response.
        */

        const subscriptionId =
            customer.subscription_id ||
            customer.subscriptionId;


        if (!subscriptionId) {

            /*
              If the customer API returns a subscription
              object, use its id.
            */

            if (
                customer.subscription &&
                customer.subscription.id
            ) {

                openTransferModal(
                    customer.subscription.id
                );

                return;

            }


            alert(
                "No active subscription found for this customer."
            );

            return;

        }


        openTransferModal(
            subscriptionId
        );

    } catch (error) {

        console.log(error);

        alert(
            "Unable to open transfer."
        );

    }

}


function openTransferModal(subscriptionId) {

    document.getElementById(
        "transferSubscriptionId"
    ).value =
        subscriptionId;


    document.getElementById(
        "transferCustomerId"
    ).value =
        "";


    const dateInput =
        document.getElementById(
            "transferDate"
        );


    if (dateInput) {

        dateInput.value =
            new Date()
                .toISOString()
                .slice(0, 10);

    }


    document
        .getElementById("transferModal")
        .classList.remove("hidden");

}


function closeTransfer() {

    document
        .getElementById("transferModal")
        .classList.add("hidden");

}


async function transferSubscription() {

    const subscriptionId =
        document.getElementById(
            "transferSubscriptionId"
        ).value;


    const customerId =
        Number(
            document.getElementById(
                "transferCustomerId"
            ).value
        );


    const transferDate =
        document.getElementById(
            "transferDate"
        ).value;


    const message =
        document.getElementById(
            "transferMessage"
        );


    if (!subscriptionId) {

        alert(
            "Subscription ID is required."
        );

        return;

    }


    if (!customerId) {

        alert(
            "Enter the new customer ID."
        );

        return;

    }


    if (!transferDate) {

        alert(
            "Select transfer date."
        );

        return;

    }


    try {

        const response =
            await api(
                `/subscriptions/${subscriptionId}/transfer`,
                {
                    method: "POST",

                    body: JSON.stringify({

                        newCustomerId:
                            customerId,

                        transferDate:
                            transferDate

                    })
                }
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            const errorText =
                data.message ||
                "Unable to transfer subscription.";


            if (message) {

                message.innerText =
                    errorText;

            } else {

                alert(errorText);

            }

            return;

        }


        if (message) {

            message.innerText =
                "Subscription transferred successfully.";

        }


        alert(
            "Subscription transferred successfully."
        );


        closeTransfer();

        closeDetails();

        loadCustomers();

        loadDashboard();

    } catch (error) {

        console.log(error);

        alert(
            "Server error while transferring subscription."
        );

    }

}
/* =========================================================
   PAYMENT
========================================================= */

function openPaymentModal(id) {

    currentCustomerId =
        id;


    document.getElementById(
        "paymentAmount"
    ).value = "";


    document.getElementById(
        "paymentNote"
    ).value = "";


    document.getElementById(
        "paymentMethod"
    ).value = "CASH";


    document
        .getElementById("paymentModal")
        .classList.remove("hidden");

}


function closePaymentModal() {

    document
        .getElementById("paymentModal")
        .classList.add("hidden");

}


async function addPayment() {

    const amount =
        Number(
            document.getElementById(
                "paymentAmount"
            ).value
        );


    const method =
        document.getElementById(
            "paymentMethod"
        ).value;


    const note =
        document.getElementById(
            "paymentNote"
        ).value.trim();


    if (!amount || amount <= 0) {

        alert(
            "Enter a valid payment amount."
        );

        return;

    }


    try {

        const response =
            await api(
                `/customers/${currentCustomerId}/payments`,
                {
                    method: "POST",

                    body: JSON.stringify({
                        amount,
                        method,
                        note
                    })
                }
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            alert(
                data.message ||
                "Unable to save payment."
            );

            return;

        }


        alert(
            "Payment saved successfully."
        );


        closePaymentModal();

        loadDashboard();

        loadBill(
            currentCustomerId
        );

    } catch (error) {

        alert(
            "Server error."
        );

    }

}


/* =========================================================
   PAYMENT HISTORY
========================================================= */

async function openPaymentHistory(id) {

    currentCustomerId =
        id;


    try {

        const response =
            await api(
                `/customers/${id}/payments`
            );


        if (!response) return;


        const data =
            await response.json();


        const payments =
            data.payments ||
            data ||
            [];


        document.getElementById(
            "paymentHistoryCustomer"
        ).innerText =
            currentCustomer
                ? currentCustomer.name
                : "Payment records";


        const container =
            document.getElementById(
                "paymentHistory"
            );


        container.innerHTML = "";


        if (!payments.length) {

            container.innerHTML = `
                <p>
                    No payment history found.
                </p>
            `;

        } else {

            payments.forEach(
                payment => {

                    container.innerHTML += `

                        <div class="paymentItem">

                            <strong>
                                ₹${Number(
                                    payment.amount || 0
                                ).toFixed(2)}
                            </strong>

                            <span>
                                ${escapeHtml(
                                    payment.method ||
                                    "CASH"
                                )}
                            </span>

                            <small>
                                ${escapeHtml(
                                    payment.payment_date ||
                                    payment.created_at ||
                                    ""
                                )}
                            </small>

                        </div>

                    `;

                }
            );

        }


        document
            .getElementById(
                "paymentHistoryModal"
            )
            .classList.remove("hidden");

    } catch (error) {

        console.log(error);

    }

}


function closePaymentHistory() {

    document
        .getElementById(
            "paymentHistoryModal"
        )
        .classList.add("hidden");

}


/* =========================================================
   INVOICE
========================================================= */

async function openInvoice(id) {

    currentCustomerId =
        id;


    try {

        const response =
            await api(
                `/customers/${id}/bill`
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            alert(
                data.message ||
                "Unable to generate invoice."
            );

            return;

        }


        const customer =
            data.customer ||
            currentCustomer;


        document.getElementById(
            "invoiceContent"
        ).innerHTML = `

            <div class="invoiceHeader">

                <h1>
                    🍱 TiffinTrack
                </h1>

                <p>
                    Monthly Tiffin Invoice
                </p>

            </div>


            <hr>


            <div class="invoiceCustomer">

                <p>
                    <strong>Customer:</strong>
                    ${escapeHtml(
                        customer?.name || ""
                    )}
                </p>


                <p>
                    <strong>Phone:</strong>
                    ${escapeHtml(
                        customer?.phone || ""
                    )}
                </p>


                <p>
                    <strong>Address:</strong>
                    ${escapeHtml(
                        customer?.address || ""
                    )}
                </p>


                <p>
                    <strong>Month:</strong>
                    ${escapeHtml(
                        data.month || ""
                    )}
                </p>

            </div>


            <div class="invoiceTable">

                <div>

                    <span>
                        Monthly Plan
                    </span>

                    <strong>
                        ₹${Number(
                            data.monthlyPlan || 0
                        ).toFixed(2)}
                    </strong>

                </div>


                <div>

                    <span>
                        Total Service Days
                    </span>

                    <strong>
                        ${data.totalServiceDays || 0}
                    </strong>

                </div>


                <div>

                    <span>
                        Served Days
                    </span>

                    <strong>
                        ${data.servedDays || 0}
                    </strong>

                </div>


                <div>

                    <span>
                        Paused Days
                    </span>

                    <strong>
                        ${data.pausedDays || 0}
                    </strong>

                </div>


                <div>

                    <span>
                        Daily Rate
                    </span>

                    <strong>
                        ₹${Number(
                            data.dailyRate || 0
                        ).toFixed(2)}
                    </strong>

                </div>


                <div>

                    <span>
                        Total Bill
                    </span>

                    <strong>
                        ₹${Number(
                            data.finalBill || 0
                        ).toFixed(2)}
                    </strong>

                </div>


                <div>

                    <span>
                        Paid
                    </span>

                    <strong>
                        ₹${Number(
                            data.paidAmount || 0
                        ).toFixed(2)}
                    </strong>

                </div>


                <div>

                    <span>
                        Balance
                    </span>

                    <strong>
                        ₹${Number(
                            data.balance || 0
                        ).toFixed(2)}
                    </strong>

                </div>

            </div>


            <div class="invoiceTotal">

                Amount Due:

                <strong>
                    ₹${Number(
                        data.balance || 0
                    ).toFixed(2)}
                </strong>

            </div>


            <p class="invoiceFooter">

                Thank you for choosing TiffinTrack.

            </p>

        `;


        document
            .getElementById("invoiceModal")
            .classList.remove("hidden");

    } catch (error) {

        alert(
            "Unable to generate invoice."
        );

    }

}


function closeInvoice() {

    document
        .getElementById("invoiceModal")
        .classList.add("hidden");

}


function printInvoice() {

    const content =
        document.getElementById(
            "invoiceContent"
        ).innerHTML;


    const printWindow =
        window.open(
            "",
            "_blank",
            "width=800,height=700"
        );


    printWindow.document.write(`

        <html>

        <head>

            <title>
                TiffinTrack Invoice
            </title>

            <style>

                body {
                    font-family: Arial, sans-serif;
                    padding: 40px;
                }

                h1 {
                    margin-bottom: 5px;
                }

                .invoiceTable div {
                    display: flex;
                    justify-content: space-between;
                    padding: 12px;
                    border-bottom: 1px solid #ddd;
                }

                .invoiceTotal {
                    margin-top: 25px;
                    font-size: 20px;
                }

            </style>

        </head>


        <body>

            ${content}

        </body>

        </html>

    `);


    printWindow.document.close();

    printWindow.focus();

    printWindow.print();

}


/* =========================================================
   REPORTS
========================================================= */

function openReports() {

    const now =
        new Date();


    document.getElementById(
        "reportMonth"
    ).value =
        now.getMonth() + 1;


    document.getElementById(
        "reportYear"
    ).value =
        now.getFullYear();


    document
        .getElementById("reportsModal")
        .classList.remove("hidden");


    loadReports();

}


function closeReports() {

    document
        .getElementById("reportsModal")
        .classList.add("hidden");

}


async function loadReports() {

    const month =
        document.getElementById(
            "reportMonth"
        ).value;


    const year =
        document.getElementById(
            "reportYear"
        ).value;


    try {

        const response =
            await api(
                `/reports?year=${year}&month=${month}`
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            alert(
                data.message ||
                "Unable to load report."
            );

            return;

        }


        const report =
            data.summary ||
            data;


        document.getElementById(
            "reportSummary"
        ).innerHTML = `

            <div class="reportCard">

                <span>
                    Customers
                </span>

                <strong>
                    ${report.totalCustomers || 0}
                </strong>

            </div>


            <div class="reportCard">

                <span>
                    Active
                </span>

                <strong>
                    ${report.activeCustomers || 0}
                </strong>

            </div>


            <div class="reportCard">

                <span>
                    Served Days
                </span>

                <strong>
                    ${report.totalServedDays || 0}
                </strong>

            </div>


            <div class="reportCard">

                <span>
                    Revenue
                </span>

                <strong>
                    ₹${Number(
                        report.totalRevenue || 0
                    ).toFixed(2)}
                </strong>

            </div>


            <div class="reportCard">

                <span>
                    Pending
                </span>

                <strong>
                    ₹${Number(
                        report.totalPending || 0
                    ).toFixed(2)}
                </strong>

            </div>

        `;


        const customers =
            data.customers || [];


        const customerContainer =
            document.getElementById(
                "reportCustomers"
            );


        customerContainer.innerHTML = `
            <h3>
                Customer Billing
            </h3>
        `;


        customers.forEach(
            customer => {

                customerContainer.innerHTML += `

                    <div class="reportCustomer">

                        <span>
                            ${escapeHtml(
                                customer.name
                            )}
                        </span>

                        <strong>
                            ₹${Number(
                                customer.finalBill || 0
                            ).toFixed(2)}
                        </strong>

                    </div>

                `;

            }
        );

    } catch (error) {

        console.log(error);

    }

}


function exportReport() {

    const summary =
        document.getElementById(
            "reportSummary"
        ).innerText;


    const customers =
        document.getElementById(
            "reportCustomers"
        ).innerText;


    const text =
        "TiffinTrack Monthly Report\n\n" +
        summary +
        "\n\n" +
        customers;


    downloadFile(
        text,
        "tiffin-report.txt",
        "text/plain"
    );

}
/* =========================================================
   DAILY DELIVERY
========================================================= */

function openDelivery() {

    document
        .getElementById("deliveryModal")
        .classList.remove("hidden");


    loadDelivery();

}


function closeDelivery() {

    document
        .getElementById("deliveryModal")
        .classList.add("hidden");

}


async function loadDelivery() {

    try {

        const response =
            await api(
                "/delivery/today"
            );


        if (!response) return;


        const data =
            await response.json();


        const customers =
            data.customers ||
            data ||
            [];


        document.getElementById(
            "deliveryDate"
        ).innerText =
            "Today's tiffin delivery list";


        document.getElementById(
            "deliveryTotal"
        ).innerText =
            customers.length;


        const delivered =
            customers.filter(
                c =>
                    c.status === "DELIVERED" ||
                    c.delivery_status === "DELIVERED"
            ).length;


        document.getElementById(
            "deliveryDone"
        ).innerText =
            delivered;


        document.getElementById(
            "deliveryPending"
        ).innerText =
            customers.length -
            delivered;


        const container =
            document.getElementById(
                "deliveryList"
            );


        container.innerHTML = "";


        if (!customers.length) {

            container.innerHTML =
                "<p>No deliveries for today.</p>";

            return;

        }


        customers.forEach(
            customer => {

                const isDelivered =
                    customer.status === "DELIVERED" ||
                    customer.delivery_status === "DELIVERED";


                container.innerHTML += `

                    <div class="deliveryItem">

                        <div>

                            <strong>
                                ${escapeHtml(
                                    customer.name
                                )}
                            </strong>

                            <small>
                                ${escapeHtml(
                                    customer.phone
                                )}
                            </small>

                        </div>


                        <button

                            class="${
                                isDelivered
                                    ? "secondary"
                                    : "primary"
                            }"

                            onclick="markDelivery(
                                ${customer.id}
                            )">

                            ${
                                isDelivered
                                    ? "✓ Delivered"
                                    : "Mark Delivered"
                            }

                        </button>

                    </div>

                `;

            }
        );

    } catch (error) {

        console.log(error);

    }

}


async function markDelivery(id) {

    try {

        const response =
            await api(
                `/delivery/today/${id}`,
                {
                    method: "POST"
                }
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            alert(
                data.message ||
                "Unable to update delivery."
            );

            return;

        }


        loadDelivery();

        loadDashboard();

    } catch (error) {

        alert(
            "Server error."
        );

    }

}


/* =========================================================
   REMINDERS
========================================================= */

async function loadReminders() {

    try {

        const response =
            await api(
                "/reminders"
            );


        if (!response) return;


        const data =
            await response.json();


        const reminders =
            data.reminders ||
            data ||
            [];


        const section =
            document.getElementById(
                "remindersSection"
            );


        const container =
            document.getElementById(
                "reminders"
            );


        section.classList.remove(
            "hidden"
        );


        container.innerHTML = "";


        if (!reminders.length) {

            container.innerHTML = `
                <p>
                    🎉 No pending payment reminders.
                </p>
            `;

            return;

        }


        reminders.forEach(
            customer => {

                container.innerHTML += `

                    <div class="reminderItem">

                        <div>

                            <strong>
                                ${escapeHtml(
                                    customer.name
                                )}
                            </strong>

                            <small>
                                ${escapeHtml(
                                    customer.phone
                                )}
                            </small>

                        </div>


                        <strong>
                            ₹${Number(
                                customer.balance || 0
                            ).toFixed(2)}
                        </strong>


                        <button
                            class="secondary"
                            onclick="openContact(
                                ${customer.id}
                            )">

                            📞 Contact

                        </button>

                    </div>

                `;

            }
        );

    } catch (error) {

        console.log(error);

    }

}


/* =========================================================
   T4 — IMPORT CUSTOMERS
========================================================= */

function openImport() {

    const modal =
        document.getElementById(
            "importModal"
        );


    if (!modal) return;


    document.getElementById(
        "importFile"
    ).value = "";


    document.getElementById(
        "importResult"
    ).innerHTML = "";


    modal.classList.remove(
        "hidden"
    );

}


function closeImport() {

    document
        .getElementById("importModal")
        .classList.add("hidden");

}


async function importCustomers() {

    const fileInput =
        document.getElementById(
            "importFile"
        );


    const result =
        document.getElementById(
            "importResult"
        );


    if (
        !fileInput ||
        !fileInput.files ||
        !fileInput.files.length
    ) {

        alert(
            "Please select a CSV file."
        );

        return;

    }


    const file =
        fileInput.files[0];


    if (
        !file.name
            .toLowerCase()
            .endsWith(".csv")
    ) {

        alert(
            "Please select a CSV file."
        );

        return;

    }


    const formData =
        new FormData();


    formData.append(
        "file",
        file
    );


    result.innerHTML =
        "<p>Importing customer data...</p>";


    try {

        const response =
            await api(
                "/customers/import",
                {
                    method: "POST",

                    body: formData
                }
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            result.innerHTML = `

                <p>
                    ❌ ${escapeHtml(
                        data.message ||
                        "Import failed."
                    )}
                </p>

            `;

            return;

        }


        result.innerHTML = `

            <div class="importSummary">

                <h3>
                    ✅ Import Complete
                </h3>

                <p>
                    Imported:
                    <strong>
                        ${data.imported || 0}
                    </strong>
                </p>

                <p>
                    Deduped:
                    <strong>
                        ${data.deduped || 0}
                    </strong>
                </p>

                <p>
                    Rejected:
                    <strong>
                        ${data.rejected || 0}
                    </strong>
                </p>

            </div>

        `;


        currentPage = 1;

        loadCustomers();

        loadDashboard();

    } catch (error) {

        console.log(error);

        result.innerHTML =
            "<p>❌ Server error during import.</p>";

    }

}


/* =========================================================
   PHONE SEARCH
========================================================= */

async function searchByPhone() {

    const phone =
        document.getElementById(
            "phoneLookup"
        ).value.trim();


    if (!/^[6-9]\d{9}$/.test(phone)) {

        alert(
            "Enter a valid 10-digit mobile number."
        );

        return;

    }


    try {

        const response =
            await api(
                `/customers/search/phone/${phone}`
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            alert(
                data.message ||
                "Customer not found."
            );

            return;

        }


        const customer =
            data.customer ||
            data;


        document.getElementById(
            "phoneResult"
        ).innerHTML = `

            <h3>
                ${escapeHtml(
                    customer.name
                )}
            </h3>


            <p>
                📱 ${escapeHtml(
                    customer.phone
                )}
            </p>


            <p>
                📍 ${escapeHtml(
                    customer.address
                )}
            </p>


            <p>
                💰 ₹${Number(
                    customer.monthly_price || 0
                ).toFixed(0)}
            </p>


            <p>

                Status:

                <strong>
                    ${escapeHtml(
                        customer.status
                    )}
                </strong>

            </p>


            <button
                class="primary full"
                onclick="viewCustomer(
                    ${customer.id}
                );
                closePhoneSearch();">

                View Customer

            </button>

        `;


        document
            .getElementById("phoneModal")
            .classList.remove("hidden");

    } catch (error) {

        alert(
            "Unable to search customer."
        );

    }

}


function closePhoneSearch() {

    document
        .getElementById("phoneModal")
        .classList.add("hidden");

}


/* =========================================================
   PROFILE
========================================================= */

async function openProfile() {

    try {

        const response =
            await api(
                "/profile"
            );


        if (!response) return;


        const data =
            await response.json();


        document.getElementById(
            "profileName"
        ).value =
            data.name || "";


        document.getElementById(
            "profileEmail"
        ).value =
            data.email || "";


        document
            .getElementById("profileModal")
            .classList.remove("hidden");

    } catch (error) {

        console.log(error);

    }

}


function closeProfile() {

    document
        .getElementById("profileModal")
        .classList.add("hidden");

}


async function updateProfile() {

    const name =
        document.getElementById(
            "profileName"
        ).value.trim();


    const email =
        document.getElementById(
            "profileEmail"
        ).value.trim();


    if (!name || !email) {

        alert(
            "Name and email are required."
        );

        return;

    }


    try {

        const response =
            await api(
                "/profile",
                {
                    method: "PUT",

                    body: JSON.stringify({
                        name,
                        email
                    })
                }
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            alert(
                data.message ||
                "Unable to update profile."
            );

            return;

        }


        document.getElementById(
            "profileMessage"
        ).innerText =
            "Profile updated successfully.";

    } catch (error) {

        alert(
            "Server error."
        );

    }

}


async function changePassword() {

    const currentPassword =
        document.getElementById(
            "currentPassword"
        ).value;


    const newPassword =
        document.getElementById(
            "newPassword"
        ).value;


    const confirmPassword =
        document.getElementById(
            "confirmPassword"
        ).value;


    if (!currentPassword || !newPassword) {

        alert(
            "Enter both passwords."
        );

        return;

    }


    if (newPassword.length < 6) {

        alert(
            "New password must be at least 6 characters."
        );

        return;

    }


    if (newPassword !== confirmPassword) {

        alert(
            "New passwords do not match."
        );

        return;

    }


    try {

        const response =
            await api(
                "/profile/password",
                {
                    method: "PUT",

                    body: JSON.stringify({
                        currentPassword,
                        newPassword
                    })
                }
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok) {

            alert(
                data.message ||
                "Unable to change password."
            );

            return;

        }


        document.getElementById(
            "profileMessage"
        ).innerText =
            "Password changed successfully.";


        document.getElementById(
            "currentPassword"
        ).value = "";


        document.getElementById(
            "newPassword"
        ).value = "";


        document.getElementById(
            "confirmPassword"
        ).value = "";

    } catch (error) {

        alert(
            "Server error."
        );

    }

}


/* =========================================================
   CONTACT / WHATSAPP
========================================================= */

async function openContact(id) {

    try {

        const response =
            await api(
                `/customers/${id}`
            );


        if (!response) return;


        const customer =
            await response.json();


        if (!response.ok) {

            alert(
                customer.message ||
                "Customer not found."
            );

            return;

        }


        currentCustomer =
            customer;


        document.getElementById(
            "contactCustomer"
        ).innerHTML = `

            <h3>
                ${escapeHtml(
                    customer.name
                )}
            </h3>


            <p>
                📱 ${escapeHtml(
                    customer.phone
                )}
            </p>

        `;


        document.getElementById(
            "callCustomer"
        ).href =
            `tel:+91${customer.phone}`;


        const whatsappMessage =
            encodeURIComponent(
                `Hello ${customer.name}, this is a message from TiffinTrack regarding your tiffin service.`
            );


        document.getElementById(
            "whatsappCustomer"
        ).href =
            `https://wa.me/91${customer.phone}?text=${whatsappMessage}`;


        document
            .getElementById("contactModal")
            .classList.remove("hidden");

    } catch (error) {

        console.log(error);

    }

}


function closeContact() {

    document
        .getElementById("contactModal")
        .classList.add("hidden");

}


/* =========================================================
   CSV EXPORT
========================================================= */

async function exportCustomers() {

    try {

        const params =
            new URLSearchParams();


        params.append(
            "page",
            1
        );


        params.append(
            "limit",
            10000
        );


        params.append(
            "sortBy",
            "name"
        );


        params.append(
            "order",
            "asc"
        );


        const search =
            document.getElementById(
                "search"
            ).value.trim();


        const status =
            document.getElementById(
                "status"
            ).value;


        if (search) {

            params.append(
                "search",
                search
            );

        }


        if (status) {

            params.append(
                "status",
                status
            );

        }


        const response =
            await api(
                "/customers?" +
                params.toString()
            );


        if (!response) return;


        const data =
            await response.json();


        const customers =
            data.customers || [];


        if (!customers.length) {

            alert(
                "No customers to export."
            );

            return;

        }


        let csv =
            "Name,Phone,Address,Monthly Plan,Status\n";


        customers.forEach(
            customer => {

                csv +=
                    `"${csvSafe(
                        customer.name
                    )}",` +

                    `"${csvSafe(
                        customer.phone
                    )}",` +

                    `"${csvSafe(
                        customer.address
                    )}",` +

                    `"${Number(
                        customer.monthly_price || 0
                    ).toFixed(2)}",` +

                    `"${csvSafe(
                        customer.status
                    )}"\n`;

            }
        );


        downloadFile(
            csv,
            "tiffin-customers.csv",
            "text/csv"
        );

    } catch (error) {

        alert(
            "Unable to export customers."
        );

    }

}


function csvSafe(value) {

    return String(
        value || ""
    ).replace(
        /"/g,
        '""'
    );

}


function downloadFile(
    content,
    filename,
    type
) {

    const blob =
        new Blob(
            [content],
            { type }
        );


    const url =
        URL.createObjectURL(
            blob
        );


    const link =
        document.createElement(
            "a"
        );


    link.href =
        url;


    link.download =
        filename;


    document.body.appendChild(
        link
    );


    link.click();


    link.remove();


    URL.revokeObjectURL(
        url
    );

}


/* =========================================================
   DARK / LIGHT THEME
========================================================= */

function toggleTheme() {

    document.body.classList.toggle(
        "dark"
    );


    const isDark =
        document.body.classList.contains(
            "dark"
        );


    localStorage.setItem(
        "theme",
        isDark
            ? "dark"
            : "light"
    );


    const button =
        document.getElementById(
            "themeButton"
        );


    if (button) {

        button.innerText =
            isDark
                ? "☀️"
                : "🌙";

    }

}


function loadTheme() {

    const theme =
        localStorage.getItem(
            "theme"
        );


    if (theme === "dark") {

        document.body.classList.add(
            "dark"
        );


        const button =
            document.getElementById(
                "themeButton"
            );


        if (button) {

            button.innerText =
                "☀️";

        }

    }

}


/* =========================================================
   GENERAL MESSAGE
========================================================= */

function showMessage(text) {

    document.getElementById(
        "generalMessage"
    ).innerText =
        text;


    document
        .getElementById("messageModal")
        .classList.remove("hidden");

}


function closeMessageModal() {

    document
        .getElementById("messageModal")
        .classList.add("hidden");

}


/* =========================================================
   LOGOUT
========================================================= */

function logout() {

    token = null;

    localStorage.removeItem(
        "token"
    );

    showLanding();

}


/* =========================================================
   HTML SECURITY HELPER
========================================================= */

function escapeHtml(value) {

    return String(
        value ?? ""
    )
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );

}