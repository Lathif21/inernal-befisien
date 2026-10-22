<script lang="ts">
	import { enhance } from '$app/forms';
	import BrandLogo from '#lib/components/BrandLogo.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let pending = $state(false);
</script>

<svelte:head>
	<title>Masuk · Befisien CRM</title>
</svelte:head>

<!-- docs/03-SCREENS.md §1: form left, blue panel with the 3D hero right, no sign-up link -->
<div class="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
	<main class="flex flex-col px-6 py-8 sm:px-12 lg:px-16">
		<BrandLogo tone="light" />

		<div class="flex flex-1 items-center py-10">
			<form
				method="post"
				class="flex w-full max-w-sm flex-col gap-5"
				use:enhance={() => {
					pending = true;
					return async ({ update }) => {
						await update({ reset: false });
						pending = false;
					};
				}}
			>
				<div class="flex flex-col gap-2">
					<h1 class="text-page-title">Masuk</h1>
					<p class="text-body text-ink-2">Masuk dengan akun Befisien Anda.</p>
				</div>

				{#if form?.message}
					<p
						role="alert"
						class="rounded-control bg-danger-bg px-3.5 py-2.5 text-small font-bold text-danger"
					>
						{form.message}
					</p>
				{/if}

				<label class="bf-field">
					Email
					<input
						name="email"
						type="email"
						autocomplete="username"
						required
						defaultValue={form?.email ?? ''}
						aria-invalid={form?.message ? 'true' : undefined}
					/>
				</label>

				<label class="bf-field">
					Kata sandi
					<input
						name="password"
						type="password"
						autocomplete="current-password"
						required
						aria-invalid={form?.message ? 'true' : undefined}
					/>
				</label>

				<button type="submit" class="bf-btn bf-btn--primary w-full" disabled={pending}>
					{pending ? 'Memproses…' : 'Masuk'}
				</button>
			</form>
		</div>

		<p class="text-small text-ink-3">© Befisien Technologies</p>
	</main>

	<aside
		class="relative hidden items-center justify-center overflow-hidden bg-accent p-12 lg:flex"
		aria-hidden="true"
	>
		<svg
			class="pointer-events-none absolute -bottom-82.5 -left-65 size-175 opacity-15"
			viewBox="0 0 600 600"
		>
			<g fill="none" stroke="currentColor" stroke-width="34" class="text-on-accent">
				<circle cx="300" cy="300" r="120" />
				<circle cx="300" cy="300" r="210" />
				<circle cx="300" cy="300" r="300" />
			</g>
		</svg>

		<div class="relative flex w-full max-w-140 flex-col gap-8">
			<!-- Layered scene, same composition as the befisien.com hero -->
			<div class="hero-scene relative aspect-957/817 w-full">
				<span class="hero-glow"></span>
				<img
					class="hero-base absolute inset-0 size-full"
					src="/illustrations/hero-base.webp"
					width="957"
					height="817"
					alt=""
				/>
				<img
					class="hero-layer hero-bob"
					src="/illustrations/hero-chat.webp"
					alt=""
					style="--l:5.75%;--t:6%;--w:15.36%"
				/>
				<img
					class="hero-layer hero-bob [animation-delay:-1.6s]"
					src="/illustrations/hero-dot.webp"
					alt=""
					style="--l:24.14%;--t:28.52%;--w:4.6%"
				/>
				<img
					class="hero-layer hero-gear"
					src="/illustrations/hero-gear.webp"
					alt=""
					style="--l:74.71%;--t:8.57%;--w:20.38%"
				/>
			</div>
			<p class="text-[26px] leading-[1.2] font-extrabold tracking-[-0.02em] text-on-accent">
				Semua klien, langkah, dan keuangan <span class="text-sky">dalam satu tempat.</span>
			</p>
		</div>
	</aside>
</div>

<style>
	.hero-scene {
		animation: hero-float 7s ease-in-out infinite;
	}
	.hero-glow {
		position: absolute;
		left: 50%;
		top: 60%;
		width: 85%;
		aspect-ratio: 1;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		/* sky at 42% → transparent, as on befisien.com */
		background: radial-gradient(
			circle,
			color-mix(in srgb, var(--color-sky) 42%, transparent),
			transparent 64%
		);
	}
	.hero-base {
		/* fade the baked-in shadow so it does not end in a hard rectangle */
		mask-image:
			linear-gradient(to right, transparent, #000 7%, #000 93%, transparent),
			linear-gradient(to bottom, #000 82%, transparent);
		mask-composite: intersect;
	}
	.hero-layer {
		position: absolute;
		left: var(--l);
		top: var(--t);
		width: var(--w);
		height: auto;
	}
	.hero-bob {
		animation: hero-bob 5s ease-in-out infinite;
	}
	.hero-gear {
		animation: hero-gear 7s ease-in-out -2s infinite;
	}
	@keyframes hero-float {
		50% {
			translate: 0 -12px;
		}
	}
	@keyframes hero-bob {
		50% {
			transform: translateY(-16px) rotate(-4deg);
		}
	}
	@keyframes hero-gear {
		0%,
		100% {
			transform: rotate(-6deg);
		}
		50% {
			transform: translateY(-12px) rotate(14deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.hero-scene,
		.hero-bob,
		.hero-gear {
			animation: none;
		}
	}
</style>
