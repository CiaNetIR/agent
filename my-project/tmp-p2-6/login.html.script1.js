
    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      try {
        await login(username, password);
      } catch (err) {
        const d = document.getElementById("error");
        d.textContent = err.message;
        d.style.display = "block";
      }
    });
  