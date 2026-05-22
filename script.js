const WORKER_URL = 'https://floral-glitter-b7b.aloby699.workers.dev';

function checkAuth() {
    const userId = localStorage.getItem('userId');
    const infoDiv = document.getElementById('user-info');
    if (userId) {
        infoDiv.innerHTML = `مرحباً ${localStorage.getItem('userName') || ''} | <button onclick="logout()">تسجيل خروج</button>`;
    } else {
        infoDiv.innerHTML = `<a href="login.html" style="color:white;">دخول</a> | <a href="register.html" style="color:white;">تسجيل</a>`;
    }
}
function logout() {
    localStorage.clear();
    window.location.href = 'index.html';
}
