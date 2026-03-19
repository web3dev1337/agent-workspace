document.addEventListener('DOMContentLoaded', () => {
  // 0. Auto-update copyright year
  const yearEl = document.getElementById('copy-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // 0b. Platform links scroll + select tab
  document.querySelectorAll('.platform-link[data-select-tab]').forEach(link => {
    link.addEventListener('click', () => {
      const tabId = link.dataset.selectTab;
      const midSection = document.getElementById('install-mid');
      if (midSection) {
        midSection.querySelectorAll('.install-tab').forEach(t => t.classList.remove('active'));
        midSection.querySelectorAll('.install-panel').forEach(p => p.classList.remove('active'));
        const tab = midSection.querySelector(`[data-tab="${tabId}"]`);
        if (tab) tab.classList.add('active');
        document.getElementById('tab-' + tabId)?.classList.add('active');
      }
    });
  });

  // 0c. Auto-detect platform and pre-select tabs + hero download button
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const isLinux = /Linux/.test(navigator.userAgent) && !(/Android/.test(navigator.userAgent));
  if (isMac) {
    document.querySelectorAll('.download-windows').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.download-mac').forEach(el => el.style.display = '');
  } else if (isLinux) {
    document.querySelectorAll('.download-windows').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.download-linux').forEach(el => el.style.display = '');
  }
  if (isMac || isLinux) {
    const tabSuffix = isMac ? 'mac' : 'linux';
    document.querySelectorAll('.install-section').forEach(section => {
      section.querySelectorAll('.install-tab').forEach(t => t.classList.remove('active'));
      section.querySelectorAll('.install-panel').forEach(p => p.classList.remove('active'));
      const matchingTab = Array.from(section.querySelectorAll('.install-tab')).find(t => t.dataset.tab.startsWith(tabSuffix));
      if (matchingTab) {
        matchingTab.classList.add('active');
        document.getElementById('tab-' + matchingTab.dataset.tab)?.classList.add('active');
      }
    });
  }

  // 1. Navbar Scroll Effect
  const navbar = document.querySelector('.fluid-nav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  });

  // 2. Intersection Observer for Reveals
  const revealOptions = {
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px"
  };

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const delay = entry.target.style.getPropertyValue('--delay') || '0s';
        entry.target.style.transitionDelay = delay;
        entry.target.classList.add('active');
        observer.unobserve(entry.target);
      }
    });
  }, revealOptions);

  document.querySelectorAll('.reveal').forEach(el => {
    revealObserver.observe(el);
  });

  // 3. 3D Mouse Tracking for Hero UI
  const heroSection = document.querySelector('.hero-fluid');
  const glassPanel = document.querySelector('.glass-panel');

  if (window.innerWidth > 1024 && heroSection) {
    heroSection.addEventListener('mousemove', (e) => {
      const rect = heroSection.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;

      // Tilt the main glass panel slightly based on mouse
      if (glassPanel) {
        glassPanel.style.transform = `rotateY(${x * -10}deg) rotateX(${y * 10}deg) scale(1.02)`;
      }
    });

    heroSection.addEventListener('mouseleave', () => {
      if (glassPanel) {
        glassPanel.style.transform = `rotateY(-15deg) rotateX(5deg) scale(0.95)`;
      }
    });
  }

  // 4. Terminal Typing Animation Sequence
  const terminalObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        startTerminalSequence();
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  const terminalFluid = document.querySelector('.terminal-fluid');
  if (terminalFluid) {
    terminalObserver.observe(terminalFluid);
  }

  function typeCommand(el, speed) {
    return new Promise(resolve => {
      const text = el.textContent;
      el.textContent = '';
      let i = 0;
      const iv = setInterval(() => {
        if (i < text.length) {
          el.textContent += text.charAt(i++);
        } else {
          clearInterval(iv);
          resolve();
        }
      }, speed);
    });
  }

  function showResponses(selector, stagger) {
    return new Promise(resolve => {
      const els = document.querySelectorAll(selector);
      let delay = 0;
      els.forEach(el => {
        setTimeout(() => el.classList.remove('hidden'), delay);
        delay += stagger;
      });
      setTimeout(resolve, delay + 200);
    });
  }

  async function startTerminalSequence() {
    await typeCommand(document.querySelector('.typing-1'), 30);
    await showResponses('.response-1', 400);

    document.querySelector('.cmd-2').classList.remove('hidden');
    await typeCommand(document.querySelector('.typing-2'), 35);
    await showResponses('.response-2', 300);

    document.querySelector('.cmd-3').classList.remove('hidden');
    await typeCommand(document.querySelector('.typing-3'), 40);
    await showResponses('.response-3', 400);

    document.querySelector('.cmd-4').classList.remove('hidden');
  }

  // 5. Install Tabs & Copy Buttons
  document.querySelectorAll('.install-section').forEach(section => {
    section.querySelectorAll('.install-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        section.querySelectorAll('.install-tab').forEach(t => t.classList.remove('active'));
        section.querySelectorAll('.install-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      });
    });
  });

  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copy).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      });
    });
  });

  // 6. Neural Network / Particle Canvas Background
  const canvas = document.getElementById('neural-bg');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let width, height;
    let particles = [];
    const colors = ['#00e5ff', '#2563eb', '#4f46e5', '#ffffff'];

    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    class Particle {
      constructor() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.radius = Math.random() * 1.5 + 0.5;
        this.color = colors[Math.floor(Math.random() * colors.length)];
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0 || this.x > width) this.vx *= -1;
        if (this.y < 0 || this.y > height) this.vy *= -1;
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
      }
    }

    // Determine particle count based on screen size for performance
    const particleCount = window.innerWidth < 768 ? 40 : 100;
    for (let i = 0; i < particleCount; i++) {
      particles.push(new Particle());
    }

    function animateCanvas() {
      ctx.clearRect(0, 0, width, height);

      // Draw particles
      particles.forEach(p => {
        p.update();
        p.draw();
      });

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 120) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            const opacity = 1 - (distance / 120);
            ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.15})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      requestAnimationFrame(animateCanvas);
    }
    
    animateCanvas();
  }
});