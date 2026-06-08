const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const mobileMenu = document.getElementById("mobileMenu");
const body = document.body;

mobileMenuBtn?.addEventListener("click", () => {
  mobileMenu.classList.toggle("open");
  body.classList.toggle("menu-open");
});

document.querySelectorAll(".mobile-menu a").forEach((link) => {
  link.addEventListener("click", () => {
    mobileMenu.classList.remove("open");
    body.classList.remove("menu-open");
  });
});

const navbar = document.getElementById("navbar");

window.addEventListener("scroll", () => {
  if (window.scrollY > 10) {
    navbar.style.background = "rgba(0,0,0,0.82)";
  } else {
    navbar.style.background = "rgba(0,0,0,0.68)";
  }
});

const revealElements = document.querySelectorAll(".reveal");

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  {
    threshold: 0.12,
    rootMargin: "0px 0px -40px 0px",
  }
);

revealElements.forEach((el) => revealObserver.observe(el));

const moodButtons = document.querySelectorAll(".mood-btn");
const moodPreview = document.getElementById("moodPreview");
const selectedMood = document.getElementById("selectedMood");

const moodClassMap = {
  sunset: "mood-sunset",
  studio: "mood-studio",
  storm: "mood-storm",
  fantasy: "mood-fantasy",
};

moodButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mood = button.dataset.mood;

    moodButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");

    moodPreview.className = "mood-preview " + moodClassMap[mood];
    selectedMood.textContent = mood.charAt(0).toUpperCase() + mood.slice(1);
  });
});

const newsletterForm = document.getElementById("newsletterForm");
const newsletterMsg = document.getElementById("newsletterMsg");

newsletterForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = newsletterForm.querySelector("input").value.trim();

  if (!email) {
    newsletterMsg.textContent = "Insere um email válido.";
    return;
  }

  newsletterMsg.textContent = "Email guardado para a beta list.";
  newsletterForm.reset();

  /*
    Próximo passo:
    Enviar este email para o backend Node.js.

    Exemplo futuro:
    fetch("/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
  */
});
