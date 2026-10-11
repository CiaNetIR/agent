
    (async () => {
      const user = await checkAuth();
      if (!user) { location.href = "login.html"; return; }

      let r;
      try {
        r = await api("/api/audit-log?page=1&page_size=100");
      } catch (e) {
        renderError(e);
        return;
      }
      const rows = (r.items || []).map(l => `
        <tr>
          <td class="font-mono text-sm">${escapeHtml(l.id)}</td>
          <td class="font-mono text-sm">${escapeHtml(l.actor_id || "—")}</td>
          <td class="font-mono text-sm">${escapeHtml(l.action || "—")}</td>
          <td class="text-sm" style="max-width: 400px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(l.details || "—")}</td>
          <td class="text-sm">${escapeHtml(l.created_at || "—")}</td>
        </tr>
      `).join("");
      document.getElementById("app").innerHTML = layout(`
        <div class="header"><h1>Audit Log</h1><span class="text-muted text-sm">مجموع: ${fmt(r.total || 0)}</span></div>
        <div class="card">
          <table>
            <thead><tr><th>ID</th><th>actor</th><th>action</th><th>details</th><th>زمان</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `);
    })();
  