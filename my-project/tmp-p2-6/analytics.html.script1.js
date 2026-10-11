
    // auth: کوکی session از نوع HttpOnly است و از document.cookie خوانده نمی‌شه؛
    // پس وضعیت لاگین را از API می‌پرسیم و فقط روی 401 ریدایرکت می‌کنیم.
    async function checkAdminAuth() {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        return r.status !== 401;
      } catch (e) {
        return true; // خطای شبکه — ادامه می‌دهیم؛ لودرها خطا را نشان می‌دهند
      }
    }

    async function apiCall(method, path) {
      const r = await fetch(path, { method, credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }
    function faDigits(n) {
      return String(n).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[+d]);
    }
    function fmt(n) {
      return faDigits(Number(n).toLocaleString('en-US'));
    }

    async function loadOverview() {
      try {
        const d = await apiCall('GET', '/api/analytics/overview');
        document.getElementById('stat-grid').innerHTML = `
          <div class="stat-card"><div class="label">MRR (۳۰ روز)</div><div class="value">${fmt(d.mrr_toman)} Toman</div></div>
          <div class="stat-card"><div class="label">کل درآمد</div><div class="value">${fmt(d.total_revenue_toman)} Toman</div></div>
          <div class="stat-card"><div class="label">کاربران کل</div><div class="value">${fmt(d.total_users)}</div></div>
          <div class="stat-card"><div class="label">اشتراک‌های فعال</div><div class="value">${fmt(d.active_subscriptions)}</div></div>
          <div class="stat-card"><div class="label">ARPU</div><div class="value">${fmt(d.arpu_toman)} Toman</div></div>
          <div class="stat-card"><div class="label">نرخ churn</div><div class="value">${faDigits(d.churn_rate_percent)}%</div></div>
        `;
      } catch (err) {
        // P2-6: خطای فارسی + دکمه‌ی تلاش مجدد (سبک renderError) — با DOM API ساخته
        // می‌شود تا message سرور بدون escape داخل HTML نیفتد
        const sg = document.getElementById('stat-grid');
        if (!sg) return;
        sg.textContent = '';
        const box = document.createElement('div');
        box.className = 'error';
        box.style.marginBottom = '12px';
        box.textContent = 'خطا: ' + err.message;
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.style.marginTop = '8px';
        btn.textContent = '🔄 تلاش مجدد';
        btn.onclick = () => location.reload();
        sg.append(box, btn);
      }
    }

    async function loadRevenueChart() {
      try {
        const d = await apiCall('GET', '/api/analytics/daily-revenue');
        new Chart(document.getElementById('revenueChart'), {
          type: 'line',
          data: {
            labels: d.labels,
            datasets: [{
              label: 'درآمد (Toman)',
              data: d.revenue,
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245,158,11,0.1)',
              fill: true, tension: 0.3,
            }]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
      } catch (err) {
        // P2-6: خطای نمودار فقط در console بود و بوم خالی می‌ماند — حالا پیام فارسی نشان می‌دهد
        console.error(err);
        const el = document.getElementById('revenueChart');
        if (el) {
          el.style.display = 'none';
          const d = document.createElement('div');
          d.className = 'error';
          d.textContent = 'خطا در بارگذاری نمودار — صفحه را رفرش کن';
          el.parentNode.insertBefore(d, el);
        }
      }
    }

    async function loadSubChart() {
      try {
        const d = await apiCall('GET', '/api/analytics/subscription-stats');
        new Chart(document.getElementById('subChart'), {
          type: 'doughnut',
          data: {
            labels: ['فعال', 'منقضی', 'بدون اشتراک', 'در انتظار'],
            datasets: [{
              data: [d.active, d.expired, d.no_subscription, d.pending],
              backgroundColor: ['#22c55e', '#ef4444', '#64748b', '#f59e0b'],
            }]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
      } catch (err) {
        // P2-6: مثل نمودار درآمد — پیام فارسی به‌جای بوم خالی
        console.error(err);
        const el = document.getElementById('subChart');
        if (el) {
          el.style.display = 'none';
          const d = document.createElement('div');
          d.className = 'error';
          d.textContent = 'خطا در بارگذاری نمودار — صفحه را رفرش کن';
          el.parentNode.insertBefore(d, el);
        }
      }
    }

    (async () => {
      if (await checkAdminAuth()) {
        Promise.all([loadOverview(), loadRevenueChart(), loadSubChart()]);
      } else {
        window.location.href = '/app/login.html';
      }
    })();
  