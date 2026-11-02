# 단어 복습장

맞힌 정도(틀렸습니다 / 비슷합니다 / 맞았습니다)에 따라 복습 간격을 단어마다 조절해 주는 영어 단어 암기 앱이에요.
친구들과 같이 쓸 수 있고, 사람마다 학습 기록이 따로 저장되며, 휴대폰 홈 화면에 앱처럼 설치돼요.

- 화면: Vite + 순수 JavaScript (PWA)
- 로그인과 데이터베이스: Supabase (아이디/비밀번호 로그인)
- 배포: Vercel (GitHub에 올리면 자동 배포)
- 모두 무료 구간으로 시작할 수 있어요.

## 만들어야 하는 계정

| 서비스 | 용도 |
|---|---|
| GitHub | 코드 보관 |
| Vercel | 앱을 인터넷에 올리기 (GitHub 계정으로 가입 가능) |
| Supabase | 로그인, 단어, 학습 기록 저장 |

## 1단계. Supabase 프로젝트 만들기

1. https://supabase.com 에서 로그인한 뒤 **New project** 를 눌러요.
2. 이름은 `voca`, Database Password는 만들어서 따로 적어 두고, Region은 **Northeast Asia (Seoul)** 을 골라요.
3. 프로젝트가 만들어지면 왼쪽 메뉴에서 **SQL Editor** → **New query** 를 열어요.
4. `supabase/schema.sql` 파일의 내용을 전부 복사해 붙여넣고 **Run** 을 눌러요. (표와 권한이 만들어져요.)
5. 새 쿼리를 열어서 `supabase/seed_words.sql` 도 같은 방법으로 실행해요. (임시 샘플 단어 40개가 들어가요.)
6. **Project Settings → API** (또는 화면 위쪽 **Connect**) 에서 아래 두 값을 복사해 둬요.
   - Project URL (예: `https://abcdefgh.supabase.co`)
   - `anon` public key 또는 Publishable key (이 값은 앱에 공개돼도 안전해요. `service_role` 키는 절대 쓰지 마세요.)

## 2단계. 아이디/비밀번호 로그인 켜기

친구들이 이메일 없이 아이디만으로 바로 가입할 수 있게 설정해요.

1. Supabase 대시보드 **Authentication → Sign In / Providers** 를 열어요.
2. **Email** 항목을 열고 아래처럼 맞춘 뒤 저장해요.
   - **Enable Email provider**: 켜짐
   - **Confirm email**: **꺼짐** (이걸 꺼야 가입하자마자 바로 쓸 수 있어요)
3. (선택) 같은 화면의 **Minimum password length** 는 6 이상이면 돼요.

앱은 아이디 뒤에 `@voca-user.com` 을 붙여 내부용 주소로 쓰고, 실제 메일은 보내지 않아요. 한 번 로그인하면 기기에 저장되어 계속 유지돼요.

## 3단계. GitHub에 올리고 Vercel로 배포

1. https://github.com 에서 새 저장소(Private도 괜찮아요)를 만들어요.
2. 이 폴더의 파일들을 그대로 올려요. 저장소 화면에서 **Add file → Upload files** 를 누르고 폴더 안의 모든 파일과 폴더(`src`, `public`, `supabase`, `package.json`, `index.html` 등)를 끌어다 놓으면 돼요. `.env` 파일은 올리지 마세요.
3. https://vercel.com 에 GitHub 계정으로 로그인하고 **Add New → Project** 에서 방금 만든 저장소를 **Import** 해요.
4. **Environment Variables** 에 두 개를 추가해요.
   - `VITE_SUPABASE_URL` = 1단계에서 복사한 Project URL
   - `VITE_SUPABASE_ANON_KEY` = 1단계에서 복사한 anon(또는 Publishable) key
5. **Deploy** 를 눌러요. 끝나면 `https://○○○.vercel.app` 같은 주소가 생겨요.

## 4단계. 첫 로그인

Vercel 주소를 열고 아이디와 비밀번호를 정한 뒤 **처음이에요 (가입하기)** 를 눌러요. 학습 기록 저장 안내가 뜨고, 동의하면 시작돼요. 다음부터는 열기만 하면 로그인된 상태예요.

## 5단계. 휴대폰에 앱처럼 설치

- **아이폰**: Safari로 주소를 열고 공유 버튼 → **홈 화면에 추가**
- **안드로이드**: Chrome으로 주소를 열고 메뉴(⋮) → **앱 설치** 또는 **홈 화면에 추가**

설치한 앱에서도 같은 아이디와 비밀번호로 로그인하면 돼요. 브라우저와 설치한 앱은 로그인이 따로 저장되니, 앱에서 한 번 더 로그인해 주세요.

## 친구들에게 알려 주세요

- 주소 하나만 보내면 돼요. 단어 목록은 같이 보고, 학습 기록은 각자 따로 쌓여요.
- 아이디와 비밀번호 외에 이름이나 연락처는 저장하지 않아요. (비밀번호는 Supabase가 암호화해서 보관해요.)
- 비밀번호를 잊으면 복구 메일이 없어요. Supabase **Authentication → Users** 에서 해당 사용자를 열어 비밀번호를 바꿔 주세요. 앱 안의 동의 화면에 어떤 기록이 저장되는지 적혀 있어요.
- 설정 화면에서 내 기록을 파일로 받거나 모두 삭제할 수 있어요.

## 단어 추가 / 교체

- 단어는 Supabase의 `words` 표에 들어 있어요. 단어장 사진을 보내 주시면 SQL(또는 CSV)로 정리해 드리고, SQL Editor에서 실행하면 모든 친구에게 바로 반영돼요.
- 샘플 단어만 지우려면 SQL Editor에서 `delete from public.words where source = 'sample';` 을 실행해요. 해당 단어의 학습 기록도 함께 지워져요.

## 업데이트

- 코드를 고치면 GitHub에 변경된 파일을 올려요. Vercel이 자동으로 다시 배포해요.
- 친구들은 아무것도 할 필요가 없어요. 앱을 다음에 열 때 새 버전이 떠요. (오래 켜 둔 앱도 6시간이 지나 다시 열면 새로 불러와요.)
- 학습 기록은 Supabase에 있어서 업데이트해도 그대로 유지돼요. 표 구조를 바꿀 때는 SQL로 안전하게 바꿔 드릴게요.

## 쌓인 데이터 보기

- Supabase **Table Editor** 에서 `review_log`(복습 한 번마다 한 줄), `card_state`(단어별 현재 상태), `study_sessions`(학습 세션), `user_settings` 를 볼 수 있어요.
- `supabase/analytics.sql` 에 자주 틀리는 단어, 시간대별 정답률, 늦게 복습할수록 틀리는지 등 예시 쿼리가 있어요.
- `review_log` 에는 이런 항목이 들어가요: 시각(사용자 기준 날짜와 시간대), 단어, 출제 방향, 평가, 복습 전후의 간격과 난이도 계수, 예정일보다 늦은 정도, 정답 보기까지와 평가까지 걸린 시간, 앱이 백그라운드로 간 적이 있는지, 발음 듣기 횟수, 세션과 카드 순번, 남은 카드 수, 기기 정보, 앱 버전.

## 내 컴퓨터에서 실행해 보기 (선택)

```bash
cp .env.example .env     # 값을 채워요
npm install
npm run dev              # http://localhost:5173
```

## 파일 구조

```
index.html              화면 뼈대
src/main.js             화면과 학습 흐름
src/sched.js            복습 주기 계산 (순수 함수)
src/store.js            Supabase 연동, 오프라인 보관함, 캐시
src/style.css           디자인
public/                 매니페스트, 서비스 워커, 아이콘 (PWA)
supabase/schema.sql     표와 접근 권한
supabase/seed_words.sql 임시 샘플 단어
supabase/analytics.sql  분석 예시 쿼리
```

## 알아 둘 점

- Supabase 무료 프로젝트는 오랫동안 접속이 없으면 일시 중지될 수 있어요. 대시보드에서 다시 켤 수 있어요.
- 인터넷이 끊겨도 앱은 열리고 학습 기록은 기기에 임시로 쌓였다가 연결되면 올라가요. 단, 한 번도 로그인하지 않은 기기에서는 오프라인으로 시작할 수 없어요.
