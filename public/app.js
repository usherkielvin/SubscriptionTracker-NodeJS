const signUpForm = document.getElementById('signUpForm');
const signInForm = document.getElementById('signInForm');
const signOutBtn = document.getElementById('signOutBtn');
const refreshBtn = document.getElementById('refreshBtn');
const createSubForm = document.getElementById('createSubForm');

const authSection = document.getElementById('auth');
const appSection = document.getElementById('app');
const statusSection = document.getElementById('status');
const statusText = document.getElementById('statusText');

const monthlyTotal = document.getElementById('monthlyTotal');
const yearlyTotal = document.getElementById('yearlyTotal');
const upcoming7 = document.getElementById('upcoming7');
const upcoming30 = document.getElementById('upcoming30');
const overdueEmpty = document.getElementById('overdueEmpty');
const overdueList = document.getElementById('overdueList');

const subsEmpty = document.getElementById('subsEmpty');
const subsList = document.getElementById('subsList');

function formatMoney(cents) {
    const n = Number(cents ?? 0);
    return `$${(n / 100).toFixed(2)}`;
}

function formatDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 10);
}

function setStatus(message, type) {
    if (!message) {
        statusSection.hidden = true;
        statusText.textContent = '';
        statusSection.className = 'card';
        return;
    }

    statusSection.hidden = false;
    statusText.textContent = message;
    statusSection.className = `card toast ${type === 'error' ? 'toast-error' : 'toast-success'}`;
}

async function api(path, options = {}) {
    const res = await fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers ?? {}),
        },
        credentials: 'include',
    });

    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { raw: text };
        }
    }

    if (!res.ok) {
        const message = data?.error || `Request failed (${res.status})`;
        const err = new Error(message);
        err.status = res.status;
        err.data = data;
        throw err;
    }

    return data;
}

async function loadMe() {
    try {
        const data = await api('/api/auth/me');
        return data.user;
    } catch (err) {
        if (err.status === 401) return null;
        throw err;
    }
}

function setMode({ user }) {
    if (user) {
        authSection.hidden = true;
        appSection.hidden = false;
        signOutBtn.hidden = false;
    } else {
        authSection.hidden = false;
        appSection.hidden = true;
        signOutBtn.hidden = true;
    }
}

function clearList(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function renderUpcoming(el, items) {
    clearList(el);
    if (!items?.length) {
        const li = document.createElement('li');
        li.className = 'muted';
        li.textContent = 'None';
        el.appendChild(li);
        return;
    }

    for (const item of items) {
        const li = document.createElement('li');
        li.textContent = `${item.name} • ${formatMoney(item.priceCents)} • ${formatDate(item.nextBillingDate)}`;
        el.appendChild(li);
    }
}

function renderOverdue(items) {
    clearList(overdueList);
    if (!items?.length) {
        overdueEmpty.hidden = false;
        return;
    }

    overdueEmpty.hidden = true;
    for (const item of items) {
        const li = document.createElement('li');
        const row = document.createElement('div');
        row.className = 'row space-between';

        const text = document.createElement('div');
        text.textContent = `${item.name} • ${formatMoney(item.priceCents)} • ${formatDate(item.nextBillingDate)}`;

        const pay = document.createElement('button');
        pay.type = 'button';
        pay.className = 'btn btn-secondary';
        pay.textContent = 'Pay';
        pay.addEventListener('click', async () => {
            setStatus('', null);
            try {
                await api(`/api/subscriptions/${item.id}/pay`, { method: 'POST' });
                await refreshAll();
                setStatus('Marked as paid.', 'success');
            } catch (err) {
                setStatus(err.message, 'error');
            }
        });

        row.appendChild(text);
        row.appendChild(pay);
        li.appendChild(row);
        overdueList.appendChild(li);
    }
}

function renderSubs(subscriptions) {
    subsList.hidden = false;
    subsEmpty.hidden = true;
    subsList.innerHTML = '';

    const heads = ['Name', 'Price', 'Cadence', 'Next bill', 'Status', 'Actions'];
    for (const h of heads) {
        const div = document.createElement('div');
        div.className = 'cell-head';
        div.textContent = h;
        subsList.appendChild(div);
    }

    for (const sub of subscriptions) {
        const cells = [
            { text: sub.name },
            { text: formatMoney(sub.priceCents) },
            { text: sub.cadence },
            { text: formatDate(sub.nextBillingDate) },
            { pill: sub.status },
            { actions: sub },
        ];

        for (const cell of cells) {
            if (cell.actions) {
                const div = document.createElement('div');
                div.className = 'cell cell-actions';

                const pay = document.createElement('button');
                pay.type = 'button';
                pay.className = 'btn btn-secondary';
                pay.textContent = 'Pay';
                pay.disabled = cell.actions.status !== 'active';
                pay.addEventListener('click', async () => {
                    setStatus('', null);
                    try {
                        await api(`/api/subscriptions/${cell.actions.id}/pay`, { method: 'POST' });
                        await refreshAll();
                        setStatus('Marked as paid.', 'success');
                    } catch (err) {
                        setStatus(err.message, 'error');
                    }
                });

                const cancel = document.createElement('button');
                cancel.type = 'button';
                cancel.className = 'btn btn-danger';
                cancel.textContent = 'Cancel';
                cancel.disabled = cell.actions.status !== 'active';
                cancel.addEventListener('click', async () => {
                    setStatus('', null);
                    try {
                        await api(`/api/subscriptions/${cell.actions.id}`, { method: 'DELETE' });
                        await refreshAll();
                        setStatus('Canceled.', 'success');
                    } catch (err) {
                        setStatus(err.message, 'error');
                    }
                });

                div.appendChild(pay);
                div.appendChild(cancel);
                subsList.appendChild(div);
                continue;
            }

            const div = document.createElement('div');
            div.className = 'cell';

            if (cell.pill) {
                const span = document.createElement('span');
                const status = String(cell.pill);
                span.className = `pill ${status === 'active' ? 'pill-active' : 'pill-canceled'}`;
                span.textContent = status;
                div.appendChild(span);
            } else {
                div.textContent = cell.text ?? '';
            }

            subsList.appendChild(div);
        }
    }
}

async function refreshSummary() {
    const data = await api('/api/summary');
    monthlyTotal.textContent = formatMoney(data.monthlyTotalCents);
    yearlyTotal.textContent = formatMoney(data.yearlyTotalCents);
    renderUpcoming(upcoming7, data.upcoming7Days);
    renderUpcoming(upcoming30, data.upcoming30Days);
}

async function refreshSubs() {
    const data = await api('/api/subscriptions');
    const subs = data.subscriptions ?? [];
    if (!subs.length) {
        subsEmpty.hidden = false;
        subsList.hidden = true;
        subsList.innerHTML = '';
        return;
    }
    subsEmpty.hidden = true;
    renderSubs(subs);
}

async function refreshOverdue() {
    const data = await api('/api/subscriptions/overdue');
    renderOverdue(data.subscriptions ?? []);
}

async function refreshAll() {
    await Promise.all([refreshSummary(), refreshOverdue(), refreshSubs()]);
}

async function bootstrap() {
    setStatus('', null);
    try {
        const user = await loadMe();
        setMode({ user });
        if (user) await refreshAll();
    } catch (err) {
        setMode({ user: null });
        setStatus(err.message, 'error');
    }
}

signUpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('', null);
    const form = new FormData(signUpForm);
    const payload = {
        email: form.get('email'),
        password: form.get('password'),
    };

    try {
        await api('/api/auth/sign-up', { method: 'POST', body: JSON.stringify(payload) });
        signUpForm.reset();
        await bootstrap();
        setStatus('Account created.', 'success');
    } catch (err) {
        setStatus(err.message, 'error');
        const passwordInput = signUpForm.querySelector('input[name="password"]');
        if (passwordInput) passwordInput.value = '';
    }
});

signInForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('', null);
    const form = new FormData(signInForm);
    const payload = {
        email: form.get('email'),
        password: form.get('password'),
    };

    try {
        await api('/api/auth/sign-in', { method: 'POST', body: JSON.stringify(payload) });
        signInForm.reset();
        await bootstrap();
        setStatus('Signed in.', 'success');
    } catch (err) {
        setStatus(err.message, 'error');
        const passwordInput = signInForm.querySelector('input[name="password"]');
        if (passwordInput) passwordInput.value = '';
    }
});

signOutBtn.addEventListener('click', async () => {
    setStatus('', null);
    try {
        await api('/api/auth/sign-out', { method: 'POST' });
        await bootstrap();
        setStatus('Signed out.', 'success');
    } catch (err) {
        setStatus(err.message, 'error');
    }
});

refreshBtn.addEventListener('click', async () => {
    setStatus('', null);
    try {
        await refreshAll();
    } catch (err) {
        setStatus(err.message, 'error');
    }
});

createSubForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('', null);
    const form = new FormData(createSubForm);
    const price = Number(form.get('price'));
    const priceCents = Number.isFinite(price) ? Math.round(price * 100) : null;

    const payload = {
        name: form.get('name'),
        priceCents,
        currency: 'USD',
        cadence: form.get('cadence'),
        nextBillingDate: form.get('nextBillingDate'),
    };

    try {
        await api('/api/subscriptions', { method: 'POST', body: JSON.stringify(payload) });
        createSubForm.reset();
        await refreshAll();
        setStatus('Subscription created.', 'success');
    } catch (err) {
        setStatus(err.message, 'error');
    }
});

bootstrap();
