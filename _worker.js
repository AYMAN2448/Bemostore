// _worker.js
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        const usersKV = env.USERS_KV;
        const productsKV = env.PRODUCTS_KV;
        const ordersKV = env.ORDERS_KV;
        const depositsKV = env.DEPOSITS_KV;
        const newsKV = env.NEWS_KV;
        const alertsKV = env.ALERTS_KV;
        const NOWPAYMENTS_API_KEY = env.NOWPAYMENTS_API_KEY;

        // ---------- تسجيل حساب ----------
        if (path === '/api/register' && method === 'POST') {
            const { name, email } = await request.json();
            const existing = await usersKV.get(email);
            if (existing) return errorResponse('البريد مستخدم', 400);
            const userId = crypto.randomUUID();
            const user = { id: userId, name, email, balance: 0, role: 'user' };
            await usersKV.put(email, JSON.stringify(user));
            await usersKV.put(userId, JSON.stringify(user));
            return new Response(JSON.stringify({ userId, name }), { headers: { 'Content-Type': 'application/json' } });
        }

        // ---------- تسجيل دخول ----------
        if (path === '/api/login' && method === 'POST') {
            const { email } = await request.json();
            const userRaw = await usersKV.get(email);
            if (!userRaw) return errorResponse('بريد غير مسجل', 404);
            const user = JSON.parse(userRaw);
            return new Response(JSON.stringify({ userId: user.id, name: user.name }), { headers: { 'Content-Type': 'application/json' } });
        }

        // ---------- جلب الرصيد ----------
        if (path === '/api/balance' && method === 'GET') {
            const userId = url.searchParams.get('userId');
            const userRaw = await usersKV.get(userId);
            if (!userRaw) return errorResponse('مستخدم غير موجود', 404);
            const user = JSON.parse(userRaw);
            return new Response(JSON.stringify({ balance: user.balance }), { headers: { 'Content-Type': 'application/json' } });
        }

        // ---------- المنتجات ----------
        if (path === '/api/products' && method === 'GET') {
            let products = await productsKV.get('list', 'json');
            if (!products) {
                products = [
                    { id: '1', nameAr: 'بطاقة Google Play 10$', price: 10 },
                    { id: '2', nameAr: 'UC PUBG 500', price: 8 }
                ];
                await productsKV.put('list', JSON.stringify(products));
            }
            return new Response(JSON.stringify(products), { headers: { 'Content-Type': 'application/json' } });
        }

        // ---------- إنشاء طلب شراء ----------
        if (path === '/api/order' && method === 'POST') {
            const { productId, quantity, paymentMethod, userId } = await request.json();
            const products = await productsKV.get('list', 'json');
            const product = products.find(p => p.id === productId);
            if (!product) return errorResponse('منتج غير موجود', 404);
            const total = product.price * quantity;

            // حالة الرصيد الداخلي
            if (paymentMethod === 'balance') {
                const userRaw = await usersKV.get(userId);
                if (!userRaw) return errorResponse('مستخدم غير موجود', 404);
                const user = JSON.parse(userRaw);
                if (user.balance < total) return errorResponse('رصيد غير كافٍ', 400);
                user.balance -= total;
                await usersKV.put(userId, JSON.stringify(user));
                await usersKV.put(user.email, JSON.stringify(user));
                const orderId = crypto.randomUUID();
                const order = { id: orderId, userId, productId, quantity, total, paymentMethod, status: 'completed', date: new Date() };
                let orders = await ordersKV.get('list', 'json') || [];
                orders.push(order);
                await ordersKV.put('list', JSON.stringify(orders));
                return new Response(JSON.stringify({ orderId, status: 'completed' }), { headers: { 'Content-Type': 'application/json' } });
            }

            // العملات الرقمية (USDT/TRX)
            if (paymentMethod === 'usdt' || paymentMethod === 'trx') {
                const depositId = crypto.randomUUID();
                const depositReq = { id: depositId, userId, amount: total, paymentMethod, status: 'pending', context: { productId, quantity } };
                await depositsKV.put(depositId, JSON.stringify(depositReq));
                const payCurrency = paymentMethod === 'usdt' ? 'USDT' : 'TRX';
                const paymentUrl = await createNowPaymentsInvoice(total, 'USD', payCurrency, depositId, NOWPAYMENTS_API_KEY);
                return new Response(JSON.stringify({ paymentUrl }), { headers: { 'Content-Type': 'application/json' } });
            }

            // يدوي
            if (paymentMethod === 'vodafone' || paymentMethod === 'bank') {
                const depositId = crypto.randomUUID();
                const depositReq = { id: depositId, userId, amount: total, paymentMethod, status: 'pending', context: { productId, quantity } };
                await depositsKV.put(depositId, JSON.stringify(depositReq));
                return new Response(JSON.stringify({ message: 'تم إرسال طلب الدفع، سيتم تفعيل الرصيد بعد التحقق اليدوي' }), { headers: { 'Content-Type': 'application/json' } });
            }
            return errorResponse('طريقة دفع غير معروفة', 400);
        }

        // ---------- شحن الرصيد (إيداع) ----------
        if (path === '/api/deposit' && method === 'POST') {
            const { userId, amount, paymentMethod, receiptUrl } = await request.json();
            if (paymentMethod === 'usdt' || paymentMethod === 'trx') {
                const depositId = crypto.randomUUID();
                const payCurrency = paymentMethod === 'usdt' ? 'USDT' : 'TRX';
                const paymentUrl = await createNowPaymentsInvoice(amount, 'USD', payCurrency, depositId, NOWPAYMENTS_API_KEY);
                const depositReq = { id: depositId, userId, amount, paymentMethod, status: 'pending' };
                await depositsKV.put(depositId, JSON.stringify(depositReq));
                return new Response(JSON.stringify({ paymentUrl }), { headers: { 'Content-Type': 'application/json' } });
            } else {
                const depositId = crypto.randomUUID();
                const depositReq = { id: depositId, userId, amount, paymentMethod, receiptUrl, status: 'pending' };
                await depositsKV.put(depositId, JSON.stringify(depositReq));
                return new Response(JSON.stringify({ message: 'تم استلام طلب الشحن، سيتم مراجعته قريباً' }), { headers: { 'Content-Type': 'application/json' } });
            }
        }

        // ---------- Webhook NowPayments ----------
        if (path === '/api/webhook/nowpayments' && method === 'POST') {
            const body = await request.json();
            const { payment_status, order_id, pay_amount } = body;
            if (payment_status === 'finished') {
                const deposit = await depositsKV.get(order_id, 'json');
                if (deposit && deposit.status === 'pending') {
                    const userRaw = await usersKV.get(deposit.userId);
                    if (userRaw) {
                        const user = JSON.parse(userRaw);
                        user.balance += deposit.amount;
                        await usersKV.put(deposit.userId, JSON.stringify(user));
                        await usersKV.put(user.email, JSON.stringify(user));
                    }
                    deposit.status = 'completed';
                    await depositsKV.put(order_id, JSON.stringify(deposit));

                    // إذا كان إيداعاً لعملية شراء
                    if (deposit.context && deposit.context.productId) {
                        const orderId = crypto.randomUUID();
                        const order = { id: orderId, userId: deposit.userId, productId: deposit.context.productId, quantity: deposit.context.quantity, total: deposit.amount, paymentMethod: 'crypto', status: 'completed', date: new Date() };
                        let orders = await ordersKV.get('list', 'json') || [];
                        orders.push(order);
                        await ordersKV.put('list', JSON.stringify(orders));
                    }
                }
            }
            return new Response('OK');
        }

        // ---------- جلب الأخبار ----------
        if (path === '/api/news' && method === 'GET') {
            let news = await newsKV.get('list', 'json') || [];
            return new Response(JSON.stringify(news), { headers: { 'Content-Type': 'application/json' } });
        }

        // ---------- جلب التنبيهات ----------
        if (path === '/api/alerts' && method === 'GET') {
            let alerts = await alertsKV.get('list', 'json') || [];
            return new Response(JSON.stringify(alerts), { headers: { 'Content-Type': 'application/json' } });
        }

        // ---------- جلب طلبات المستخدم ----------
        if (path === '/api/orders' && method === 'GET') {
            const userId = url.searchParams.get('userId');
            let orders = await ordersKV.get('list', 'json') || [];
            const userOrders = orders.filter(o => o.userId === userId);
            return new Response(JSON.stringify(userOrders), { headers: { 'Content-Type': 'application/json' } });
        }

        // ---------- ADMIN API ----------
        if (path === '/api/admin/pending-deposits' && method === 'GET') {
            const list = await depositsKV.list();
            const pending = [];
            for (const key of list.keys) {
                const deposit = await depositsKV.get(key.name, 'json');
                if (deposit && deposit.status === 'pending' && (deposit.paymentMethod === 'vodafone' || deposit.paymentMethod === 'bank')) pending.push(deposit);
            }
            return new Response(JSON.stringify(pending), { headers: { 'Content-Type': 'application/json' } });
        }

        if (path === '/api/admin/approve-deposit' && method === 'POST') {
            const { id } = await request.json();
            const deposit = await depositsKV.get(id, 'json');
            if (deposit && deposit.status === 'pending') {
                const userRaw = await usersKV.get(deposit.userId);
                if (userRaw) {
                    const user = JSON.parse(userRaw);
                    user.balance += deposit.amount;
                    await usersKV.put(deposit.userId, JSON.stringify(user));
                    await usersKV.put(user.email, JSON.stringify(user));
                }
                deposit.status = 'completed';
                await depositsKV.put(id, JSON.stringify(deposit));
                if (deposit.context && deposit.context.productId) {
                    const orderId = crypto.randomUUID();
                    const order = { id: orderId, userId: deposit.userId, productId: deposit.context.productId, quantity: deposit.context.quantity, total: deposit.amount, paymentMethod: deposit.paymentMethod, status: 'completed', date: new Date() };
                    let orders = await ordersKV.get('list', 'json') || [];
                    orders.push(order);
                    await ordersKV.put('list', JSON.stringify(orders));
                }
            }
            return new Response('OK');
        }

        if (path === '/api/admin/reject-deposit' && method === 'POST') {
            const { id } = await request.json();
            const deposit = await depositsKV.get(id, 'json');
            if (deposit) { deposit.status = 'rejected'; await depositsKV.put(id, JSON.stringify(deposit)); }
            return new Response('OK');
        }

        if (path === '/api/admin/news' && method === 'POST') {
            const { title } = await request.json();
            let news = await newsKV.get('list', 'json') || [];
            news.unshift({ id: crypto.randomUUID(), title, date: new Date() });
            await newsKV.put('list', JSON.stringify(news));
            return new Response('OK');
        }

        if (path === '/api/admin/alert' && method === 'POST') {
            const { message } = await request.json();
            let alerts = await alertsKV.get('list', 'json') || [];
            alerts.unshift({ id: crypto.randomUUID(), message, date: new Date() });
            await alertsKV.put('list', JSON.stringify(alerts));
            return new Response('OK');
        }

        return new Response('Not found', { status: 404 });
    }
};

async function createNowPaymentsInvoice(amount, currencyFrom, currencyTo, orderId, apiKey) {
    const url = 'https://api.nowpayments.io/v1/invoice';
    const payload = { price_amount: amount, price_currency: currencyFrom, pay_currency: currencyTo, order_id: orderId, ipn_callback_url: 'https://your-worker.workers.dev/api/webhook/nowpayments' };
    const resp = await fetch(url, { method: 'POST', headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await resp.json();
    return data.invoice_url;
}
function errorResponse(msg, status) { return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } }); }
