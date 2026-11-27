// Biblioteca de peças do AuGPT (27/11/2026). As formas que os modelos erravam no teste de 15 pedidos (gancho em J,
// suporte inclinado, suporte de parede com braço, engrenagem, caixa com tampa de encaixe) prontas e medidas: o modelo
// só chama o módulo com as medidas do pedido. Tudo em mm, apoiado na mesa (z = 0), começando em x = 0, y = 0.
// Uso: include <augpt.scad>

$fn = 64;

// furo passante vertical (para usar dentro de difference)
module furo(x, y, d, altura = 100) { translate([x, y, -1]) cylinder(h = altura + 2, d = d); }

// placa com cantos arredondados (raio 0 = cantos vivos)
module placa(largura, profundidade, espessura, raio = 0) {
  if (raio <= 0) cube([largura, profundidade, espessura]);
  else hull() for (x = [raio, largura - raio], y = [raio, profundidade - raio]) translate([x, y, 0]) cylinder(h = espessura, r = raio);
}

// placa com furos: furos = lista de [x, y]; ou a 'margem' das bordas nos 4 cantos se furos = []
module placa_com_furos(largura, profundidade, espessura, d_furo, margem = 5, furos = [], raio = 0) {
  pontos = len(furos) ? furos : [[margem, margem], [largura - margem, margem], [margem, profundidade - margem], [largura - margem, profundidade - margem]];
  difference() {
    placa(largura, profundidade, espessura, raio);
    for (p = pontos) furo(p[0], p[1], d_furo, espessura);
  }
}

// caixa aberta em cima; divisorias_x / divisorias_y = quantas divisórias internas em cada direção (compartimentos iguais)
module caixa(largura, profundidade, altura, parede = 2, fundo = 2, divisorias_x = 0, divisorias_y = 0, raio = 0) {
  difference() {
    placa(largura, profundidade, altura, raio);
    translate([parede, parede, fundo]) placa(largura - 2 * parede, profundidade - 2 * parede, altura, max(0, raio - parede));
  }
  vao_x = (largura - 2 * parede - divisorias_x * parede) / (divisorias_x + 1);
  vao_y = (profundidade - 2 * parede - divisorias_y * parede) / (divisorias_y + 1);
  for (i = [1 : divisorias_x]) if (divisorias_x > 0) translate([parede + i * vao_x + (i - 1) * parede, 0, 0]) cube([parede, profundidade, altura]);
  for (i = [1 : divisorias_y]) if (divisorias_y > 0) translate([0, parede + i * vao_y + (i - 1) * parede, 0]) cube([largura, parede, altura]);
}

// tampa da caixa (medida de fora da caixa): placa + aba por baixo que entra entre as paredes; 'folga' de encaixe.
// Fica de cabeça para baixo na mesa (a aba para cima), que é como se imprime.
module tampa(largura, profundidade, espessura = 2, parede_da_caixa = 2, aba = 5, espessura_aba = 1.5, folga = 0.3, raio = 0) {
  placa(largura, profundidade, espessura, raio);
  dentro_x = largura - 2 * parede_da_caixa - 2 * folga;
  dentro_y = profundidade - 2 * parede_da_caixa - 2 * folga;
  translate([parede_da_caixa + folga, parede_da_caixa + folga, espessura - 0.01])
    difference() {
      cube([dentro_x, dentro_y, aba]);
      translate([espessura_aba, espessura_aba, -1]) cube([dentro_x - 2 * espessura_aba, dentro_y - 2 * espessura_aba, aba + 2]);
    }
}

// tubo / copo: fundo = 0 deixa aberto dos dois lados
module tubo(d_externo, altura, parede = 2, fundo = 0) {
  difference() {
    cylinder(h = altura, d = d_externo);
    translate([0, 0, fundo > 0 ? fundo : -1]) cylinder(h = altura + 2, d = d_externo - 2 * parede);
  }
}

// cantoneira em L: aba deitada na mesa (comprimento a), aba de pé (comprimento b), furos no meio de cada aba
module cantoneira(aba_deitada, aba_de_pe, largura, espessura, d_furo = 0) {
  difference() {
    union() {
      cube([aba_deitada, largura, espessura]);
      cube([espessura, largura, aba_de_pe]);
    }
    if (d_furo > 0) {
      translate([espessura + (aba_deitada - espessura) / 2, largura / 2, -1]) cylinder(h = espessura + 2, d = d_furo);
      translate([-1, largura / 2, espessura + (aba_de_pe - espessura) / 2]) rotate([0, 90, 0]) cylinder(h = espessura + 2, d = d_furo);
    }
  }
}

// gancho de parede em J: placa (altura × espessura) com furos de parafuso e, embaixo, a curva em U que sai 'alcance'
// para a frente e sobe até 'ponta' (altura da ponta desde o fundo). Impresso deitado de lado (perfil extrudado pela
// largura), que é o jeito mais forte para gancho.
module gancho_j(altura = 60, largura = 20, espessura = 4, alcance = 25, ponta = 15, d_furo = 4, furos = 2) {
  r = alcance / 2;
  difference() {
    linear_extrude(height = largura) union() {
      translate([0, r]) square([espessura, altura - r]);
      translate([r, r]) difference() {
        circle(r = r);
        circle(r = r - espessura);
        translate([-r - 1, 0]) square([2 * r + 2, r + 1]);
      }
      if (ponta > r) translate([alcance - espessura, r]) square([espessura, ponta - r]);
    }
    for (i = [1 : furos]) translate([-1, r + (altura - r) * i / (furos + 1), largura / 2]) rotate([0, 90, 0]) cylinder(h = espessura + 2, d = d_furo);
  }
}

// suporte inclinado de mesa (celular, tablet): base, encosto no 'angulo' (graus a partir da mesa) e borda na frente
module suporte_inclinado(largura = 70, profundidade = 80, altura_encosto = 90, angulo = 60, espessura = 4, borda = 10) {
  // o encosto girado passava 2 mm abaixo da mesa: a peça é cortada no z = 0 (fundo reto para imprimir)
  intersection() {
    translate([-1, -profundidade, 0]) cube([largura + 2, profundidade * 3, altura_encosto * 2]);
    suporte_inclinado_bruto(largura, profundidade, altura_encosto, angulo, espessura, borda);
  }
}
module suporte_inclinado_bruto(largura, profundidade, altura_encosto, angulo, espessura, borda) {
  cube([largura, profundidade, espessura]);
  translate([0, 0, 0]) cube([largura, espessura, borda + espessura]);
  pe = profundidade * 0.35;
  translate([0, pe, 0]) rotate([angulo - 90, 0, 0]) translate([0, 0, 0]) cube([largura, espessura, altura_encosto]);
  // escora de trás, do fim da base até o encosto
  hull() {
    translate([0, profundidade - espessura, 0]) cube([largura, espessura, espessura]);
    translate([0, pe, 0]) rotate([angulo - 90, 0, 0]) translate([0, 0, altura_encosto * 0.5]) cube([largura, espessura, espessura]);
  }
}

// suporte de parede com braço reto (fone, headset, ferramenta): placa de pé com furos e braço que sai 'braco' para a
// frente, com uma borda de 'borda' na ponta. Deitado de costas na mesa para imprimir.
module suporte_parede(largura = 40, altura = 50, espessura = 5, braco = 60, borda = 10, largura_braco = 20, d_furo = 4) {
  difference() {
    cube([largura, altura, espessura]);
    for (y = [altura * 0.25, altura * 0.75]) translate([largura / 2, y, -1]) cylinder(h = espessura + 2, d = d_furo);
  }
  translate([(largura - largura_braco) / 2, altura * 0.4 - espessura, 0]) {
    cube([largura_braco, espessura * 2, braco + espessura]);
    translate([0, 0, braco]) cube([largura_braco, borda + espessura * 2, espessura]);
  }
}

// engrenagem reta (perfil de evolvente aproximado): dentes, módulo, espessura, furo; diâmetro externo = módulo × (dentes + 2)
module engrenagem(dentes = 20, modulo = 2, espessura = 5, d_furo = 5, angulo_pressao = 20) {
  rp = modulo * dentes / 2;
  ra = rp + modulo;
  rf = max(rp - 1.25 * modulo, 1);
  rb = rp * cos(angulo_pressao);
  function inv(a) = tan(a) - a * PI / 180;
  function ponto(r, ang) = [r * cos(ang), r * sin(ang)];
  meio = 90 / dentes + inv(angulo_pressao) * 180 / PI;
  passos = 6;
  function lado(s) = [for (i = [0 : passos]) let(r = max(rb, rf) + (ra - max(rb, rf)) * i / passos, a = acos(min(1, rb / r)), t = (inv(a) * 180 / PI)) ponto(r, s * (meio - t))];
  dente = concat([ponto(rf, -meio * 1.4)], lado(-1), [for (p = [len(lado(1)) - 1 : -1 : 0]) lado(1)[p]], [ponto(rf, meio * 1.4)]);
  difference() {
    linear_extrude(height = espessura) union() {
      circle(r = rf + 0.01, $fn = dentes * 4);
      for (k = [0 : dentes - 1]) rotate(k * 360 / dentes) polygon(dente);
    }
    furo(0, 0, d_furo, espessura);
  }
}

// botão (knob): cilindro com furo em D por baixo para eixo (d_eixo, lado chato a 'chato' do lado oposto)
module knob(diametro = 30, altura = 15, d_eixo = 6, chato = 4.5, profundidade_furo = 12, recartilhado = 24) {
  difference() {
    union() {
      cylinder(h = altura, d = diametro - 1);
      if (recartilhado > 0) for (k = [0 : recartilhado - 1]) rotate(k * 360 / recartilhado) translate([diametro / 2 - 1, 0, 0]) cylinder(h = altura, d = 2, $fn = 12);
    }
    translate([0, 0, -1]) intersection() {
      cylinder(h = profundidade_furo + 1, d = d_eixo + 0.2);
      translate([-d_eixo, -d_eixo / 2 - 0.1, 0]) cube([d_eixo * 2, chato + 0.2, profundidade_furo + 1]);
    }
  }
}

// texto em relevo (sobre z = base) ou gravado (profundidade negativa), centrado em (x, y)
module texto(t, tamanho, x, y, base, altura = 1, fonte = "Liberation Sans:style=Bold") {
  translate([x, y, base]) linear_extrude(height = altura) text(t, size = tamanho, font = fonte, halign = "center", valign = "center");
}
