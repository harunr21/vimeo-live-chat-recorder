# Vimeo Canlı Sohbet Kaydedici

Vimeo canlı yayınlarının sohbet alanını algılar, yayındaki mesajları otomatik kaydeder ve kayıt bittiğinde indirmeye hazır tutar.

İsteğe bağlı **otomatik indirme** ayarı açık olduğunda yayın sonu algılandığı anda JSON ve TXT kayıtları kullanıcı müdahalesi olmadan indirilir.

## Kayıt biçimi

- **JSON (önerilen):** Her mesaj için kullanıcı adı, sohbetin gösterdiği saat, metin ve yakalama zamanını yapısal olarak saklar.
- **TXT:** Kolay okunur satır formatıdır: `[14:32] Kullanıcı: Mesaj`.

## Kurulum

1. Chrome'da `chrome://extensions` açın ve **Geliştirici modu**nu açın.
2. **Paketlenmemiş öğe yükle**ye tıklayın.
3. Bu projenin `extension` klasörünü seçin.
4. Vimeo canlı yayın sayfanızı açın. Sohbet alanı yüklendiğinde kayıt kendiliğinden başlar.

Eklentiyi ilk kez yüklediğinizde veya kodu güncelledikten sonra, önceden açık olan Vimeo sekmesini bir kez yenileyin. Chrome içerik betiklerini açık sayfalara geriye dönük olarak enjekte etmez.

Yayın bittiğinde eklenti yayın sonu sinyalini algılayıp kaydı tamamlar. Eklenti simgesinden JSON veya TXT olarak indirebilirsiniz. Son kayıt bu cihazda eklenti yerel verisine de saklanır; yayın sekmesini kapattıktan sonra bile eklenti simgesinden indirebilirsiniz.

Yayın oynatıcısı ile sohbet farklı iframe'lerde açılsa bile yayın sonu sinyali sohbet kaydına iletilir. Otomatik indirme işlemi arka planda tek kez çalıştırılır; yayın sonunda JSON ve TXT dosyaları Chrome'un varsayılan indirme klasörüne kaydedilir.

## Notlar

- Vimeo'nin sohbet arayüzü değişirse seçicilerin güncellenmesi gerekebilir.
- İlk yükleme sırasında sohbette görünür olan eski mesajlar da kayda eklenir.
