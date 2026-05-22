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
            try {
                const { name, email } = await request.json();
                if (!name || !email) return errorResponse('البريد والاسم مطلوبان', 400);
                const existing = await usersKV.get(email);
                if (existing) return errorResponse('البريد مستخدم', 400);
                const userId = crypto.randomUUID();
                const user = { id: userId, name, email, balance: 0, role: 'user' };
                await usersKV.put(email, JSON.stringify(user));
                await usersKV.put(userId, JSON.stringify(user));
                return new Response(JSON.stringify({ userId, name }), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return errorResponse('خطأ في تسجيل الحساب', 500);
            }
        }

        // ---------- تسجيل دخول ----------
        if (path === '/api/login' && method === 'POST') {
            try {
                const { email } = await request.json();
                if (!email) return errorResponse('البريد مطلوب', 400);
                const userRaw = await usersKV.get(email);
                if (!userRaw) return errorResponse('بريد غير مسجل', 404);
                const user = JSON.parse(userRaw);
                return new Response(JSON.stringify({ userId: user.id, name: user.name }), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return errorResponse('خطأ في تسجيل الدخول', 500);
            }
        }

        // ---------- جلب الرصيد ----------
        if (path === '/api/balance' && method === 'GET') {
            try {
                const userId = url.searchParams.get('userId');
                if (!userId) return errorResponse('معرف المستخدم مطلوب', 400);
                const userRaw = await usersKV.get(userId);
                if (!userRaw) return errorResponse('مستخدم غير موجود', 404);
                const user = JSON.parse(userRaw);
                return new Response(JSON.stringify({ balance: user.balance }), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return errorResponse('خطأ في جلب الرصيد', 500);
            }
        }

        // ---------- المنتجات ----------
        if (path === '/api/products' && method === 'GET') {
            try {
                let products = await productsKV.get('list');
                if (!products) {
                    products = [
                        { id: '1', nameAr: 'بطاقة Google Play 10$', price: 10 },
                        { id: '2', nameAr: 'UC PUBG 500', price: 8 }
                    ];
                    await productsKV.put('list', JSON.stringify(products));
                } else {
                    products = JSON.parse(products);
                }
                return new Response(JSON.stringify(products), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return errorResponse('خطأ في جلب المنتجات', 500);
            }
        }

        // ---------- إنشاء طلب شراء ----------
        if (path === '/api/order' && method === 'POST') {
            try {
                const { productId, quantity, paymentMethod, userId } = await request.json();
                if (!productId || !quantity || !paymentMethod || !userId) return errorResponse('جميع الحقول مطلوبة', 400);

                let productsData = await productsKV.get('list');
                if (!productsData) productsData = '[]';
                const products = JSON.parse(productsData);

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
                    const order = { id: orderId, userId, productId, quantity, total, paymentMethod, status: 'completed', date: new Date().toISOString() };
                    let orders = await ordersKV.get('list');
                    orders = orders ? JSON.parse(orders) : [];
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
            } catch (e) {
                return errorResponse('خطأ في إنشاء الطلب', 500);
            }
        }

        // ---------- شحن الرصيد (إيداع) ----------
        if (path === '/api/deposit' && method === 'POST') {
            try {
                const { userId, amount, paymentMethod, receiptUrl } = await request.json();
                if (!userId || !amount || !paymentMethod) return errorResponse('البيانات غير كاملة', 400);

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
            } catch (e) {
                return errorResponse('خطأ في عملية الشحن', 500);
            }
        }

        // ---------- Webhook NowPayments ----------
        if (path === '/api/webhook/nowpayments' && method === 'POST') {
            try {
                const body = await request.json();
                const { payment_status, order_id } = body;
                if (payment_status === 'finished') {
                    const deposit = await depositsKV.get(order_id);
                    if (!deposit) return new Response('Deposit not found', { status: 404 });

                    const depositData = JSON.parse(deposit);
                    if (depositData.status !== 'pending') return new Response('Already processed', { status: 200 });

                    const userRaw = await usersKV.get(depositData.userId);
                    if (userRaw) {
                        const user = JSON.parse(userRaw);
                        user.balance += depositData.amount;
                        await usersKV.put(depositData.userId, JSON.stringify(user));
                        await usersKV.put(user.email, JSON.stringify(user));
                    }
                    depositData.status = 'completed';
                    await depositsKV.put(order_id, JSON.stringify(depositData));

                    // إذا كان إيداعاً لعملية شراء
                    if (depositData.context && depositData.context.productId) {
                        const orderId = crypto.randomUUID();
                        const order = { id: orderId, userId: depositData.userId, productId: depositData.context.productId, quantity: depositData.context.quantity, total: depositData.amount, paymentMethod: 'crypto', status: 'completed', date: new Date().toISOString() };
                        let orders = await ordersKV.get('list');
                        orders = orders ? JSON.parse(orders) : [];
                        orders.push(order);
                        await ordersKV.put('list', JSON.stringify(orders));
                    }
                }
                return new Response('OK');
            } catch (e) {
                console.error('Webhook error:', e);
                return new Response('Error', { status: 500 });
            }
        }

        // ---------- جلب الأخبار ----------
        if (path === '/api/news' && method === 'GET') {
            try {
                let news = await newsKV.get('list');
                news = news ? JSON.parse(news) : [];
                return new Response(JSON.stringify(news), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return errorResponse('خطأ في جلب الأخبار', 500);
            }
        }

        // ---------- جلب التنبيهات ----------
        if (path === '/api/alerts' && method === 'GET') {
            try {
                let alerts = await alertsKV.get('list');
                alerts = alerts ? JSON.parse(alerts) : [];
                return new Response(JSON.stringify(alerts), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return errorResponse('خطأ في جلب التنبيهات', 500);
            }
        }

        // ---------- جلب طلبات المستخدم ----------
        if (path === '/api/orders' && method === 'GET') {
            try {
                const userId = url.searchParams.get('userId');
                if (!userId) return errorResponse('معرف المستخدم مطلوب', 400);
                let orders = await ordersKV.get('list');
                orders = orders ? JSON.parse(orders) : [];
                const userOrders = orders.filter(o => o.userId === userId);
                return new Response(JSON.stringify(userOrders), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return errorResponse('خطأ في جلب الطلبات', 500);
            }
        }

        // ---------- ADMIN API ----------
        if (path === '/api/admin/pending-deposits' && method === 'GET') {
            try {
                const adminKey = url.searchParams.get('adminKey');
                if (adminKey !== env.ADMIN_KEY) return errorResponse('صلاحيات غير كافية', 403);

                const list = await depositsKV.list();
                const pending = [];
                for (const key of list.keys) {
                    const deposit = await depositsKV.get(key.name);
                    if (deposit) {
                        const depositData = JSON.parse(deposit);
                        if (depositData.status === 'pending' && (depositData.paymentMethod === 'vodafone' || depositData.paymentMethod === 'bank')) {
                            pending.push(depositData);
                        }
                    }
                }
                return new Response(JSON.stringify(pending), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return errorResponse('خطأ في جلب الإيداعات المعلقة', 500);
            }
        }

        if (path === '/api/admin/approve-deposit' && method === 'POST') {
            try {
                const body = await request.json();
                const { id, adminKey } = body;
                if (adminKey !== env.ADMIN_KEY) return errorResponse('صلاحيات غير كافية', 403);

                const deposit = await depositsKV.get(id);
                if (!deposit) return errorResponse('إيداع غير موجود', 404);

                const depositData = JSON.parse(deposit);
                if (depositData.status !== 'pending') return errorResponse('الإيداع تم معالجته مسبقاً', 400);

                const userRaw = await usersKV.get(depositData.userId);
                if (userRaw) {
                    const user = JSON.parse(userRaw);
                    user.balance += depositData.amount;
                    await usersKV.put(depositData.userId, JSON.stringify(user));
                    await usersKV.put(user.email, JSON.stringify(user));
                }
                depositData.status = 'completed';
                await depositsKV.put(id, JSON.stringify(depositData));

                if (depositData.context && depositData.context.productId) {
                    const orderId = crypto.randomUUID();
                    const order = { id: orderId, userId: depositData.userId, productId: depositData.context.productId, quantity: depositData.context.quantity, total: depositData.amount, paymentMethod: depositData.paymentMethod, status: 'completed', date: new Date().toISOString() };
                    let orders = await ordersKV.get('list');
                    orders = orders ? JSON.parse(orders) : [];
                    orders.push(order);
                    await ordersKV.put('list', JSON.stringify(orders));
                }
                return new Response('OK');
            } catch (e) {
                return errorResponse('خطأ في الموافقة ��لى الإيداع', 500);
            }
        }

        if (path === '/api/admin/reject-deposit' && method === 'POST') {
            try {
                const body = await request.json();
                const { id, adminKey } = body;
                if (adminKey !== env.ADMIN_KEY) return errorResponse('صلاحيات غير كافية', 403);

                const deposit = await depositsKV.get(id);
                if (deposit) {
                    const depositData = JSON.parse(deposit);
                    depositData.status = 'rejected';
                    await depositsKV.put(id, JSON.stringify(depositData));
                }
                return new Response('OK');
            } catch (e) {
                return errorResponse('خطأ في رفض الإيداع', 500);
            }
        }

        if (path === '/api/admin/news' && method === 'POST') {
            try {
                const body = await request.json();
                const { title, adminKey } = body;
                if (adminKey !== env.ADMIN_KEY) return errorResponse('صلاحيات غير كافية', 403);
                if (!title) return errorResponse('العنوان مطلوب', 400);

                let news = await newsKV.get('list');
                news = news ? JSON.parse(news) : [];
                news.unshift({ id: crypto.randomUUID(), title, date: new Date().toISOString() });
                await newsKV.put('list', JSON.stringify(news));
                return new Response('OK');
            } catch (e) {
                return errorResponse('خطأ في إضافة الخبر', 500);
            }
        }

        if (path === '/api/admin/alert' && method === 'POST') {
            try {
                const body = await request.json();
                const { message, adminKey } = body;
                if (adminKey !== env.ADMIN_KEY) return errorResponse('صلاحيات غير كافية', 403);
                if (!message) return errorResponse('الرسالة مطلوبة', 400);

                let alerts = await alertsKV.get('list');
                alerts = alerts ? JSON.parse(alerts) : [];
                alerts.unshift({ id: crypto.randomUUID(), message, date: new Date().toISOString() });
                await alertsKV.put('list', JSON.stringify(alerts));
                return new Response('OK');
            } catch (e) {
                return errorResponse('خطأ في إضافة التنبيه', 500);
            }
        }

        return new Response('Not found', { status: 404 });
    }
};

async function createNowPaymentsInvoice(amount, currencyFrom, currencyTo, orderId, apiKey) {
    try {
        const url = 'https://api.nowpayments.io/v1/invoice';
        const payload = { price_amount: amount, price_currency: currencyFrom, pay_currency: currencyTo, order_id: orderId, ipn_callback_url: 'https://your-worker.workers.dev/api/webhook/nowpayments' };
        const resp = await fetch(url, { method: 'POST', headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await resp.json();
        if (!data.invoice_url) throw new Error('No invoice URL returned');
        return data.invoice_url;
    } catch (e) {
        console.error('Invoice creation error:', e);
        throw e;
    }
}

function errorResponse(msg, status) {
    return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
