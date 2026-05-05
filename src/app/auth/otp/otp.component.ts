// src/app/auth/otp/otp.component.ts
import { Component, OnInit, OnDestroy, AfterViewInit, signal, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../shared/services/auth.service';
import { ToastService } from '../../shared/services/toast.service';

@Component({
  selector: 'app-otp',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './otp.component.html',
  styleUrls: ['./otp.component.css']
})
export class OtpComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChildren('otpInput') inputs!: QueryList<ElementRef<HTMLInputElement>>;

  codes    = ['','','','','',''];
  loading  = signal(false);
  erreur   = signal('');
  countdown= signal(300);
  expired  = signal(false);
  renvoye  = signal(false);
  private timer: any;

  timerDisplay = () => {
    const m = Math.floor(this.countdown() / 60).toString().padStart(2,'0');
    const s = (this.countdown() % 60).toString().padStart(2,'0');
    return `${m}:${s}`;
  };
  codeComplet = () => this.codes.every(c => c !== '');

  constructor(private auth: AuthService, private toast: ToastService) {}

  ngOnInit()        { this.startTimer(); }
  ngAfterViewInit() { setTimeout(() => this.inputs.first?.nativeElement.focus(), 100); }
  ngOnDestroy()     { clearInterval(this.timer); }

  private startTimer() {
    this.countdown.set(300); this.expired.set(false);
    this.timer = setInterval(() => {
      const v = this.countdown() - 1;
      this.countdown.set(v);
      if (v <= 0) { clearInterval(this.timer); this.expired.set(true); }
    }, 1000);
  }

  onInput(e: Event, idx: number) {
    const el  = e.target as HTMLInputElement;
    const val = el.value.replace(/\D/,'').slice(-1);
    this.codes[idx] = val; el.value = val;
    this.erreur.set('');
    if (val && idx < 5) this.inputs.get(idx+1)?.nativeElement.focus();
    if (this.codeComplet()) this.verifier();
  }

  onKeydown(e: KeyboardEvent, idx: number) {
    if (e.key === 'Backspace' && !this.codes[idx] && idx > 0) {
      this.codes[idx-1] = '';
      this.inputs.get(idx-1)?.nativeElement.focus();
    }
  }

  onPaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text')?.replace(/\D/g,'') ?? '';
    if (text.length === 6) {
      text.split('').forEach((c,i) => { this.codes[i]=c; const el=this.inputs.get(i)?.nativeElement; if(el) el.value=c; });
      this.inputs.last?.nativeElement.focus();
      this.verifier();
    }
  }

  verifier() {
    if (!this.codeComplet() || this.expired()) return;
    this.loading.set(true); this.erreur.set('');
    this.auth.verifierOtp(this.codes.join('')).subscribe({
      next:  () => this.loading.set(false),
      error: err => {
        this.loading.set(false);
        this.erreur.set(err.error?.message || 'Code OTP incorrect.');
        this.codes = ['','','','','',''];
        this.inputs.forEach(i => i.nativeElement.value = '');
        this.inputs.first?.nativeElement.focus();
      }
    });
  }

  renvoyer() {
    clearInterval(this.timer);
    this.auth.renvoyerOtp().subscribe({
      next: () => {
        this.renvoye.set(true);
        this.startTimer();
        setTimeout(() => this.renvoye.set(false), 3000);
        this.toast.success('Nouveau code OTP envoyé par Email');
      }
    });
  }
}
