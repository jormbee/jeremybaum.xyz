const toggleButton = document.querySelector('#toggle-dark-mode');

toggleButton.addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
});