const toggleButton = document.querySelector('#toggle-dark-mode');

toggleButton.addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');

  console.log(document.body.classList)
  toggleButton.innerText = document.body.classList.contains("dark-mode") ? "☀️" : "🌙"
});