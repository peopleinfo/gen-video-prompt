Sora 2 Complete Guide to Prompts
Writing video cues is like giving a briefing to a cinematographer—clear instructions help Sora 2 better understand your creative intent. This guide, based on the OpenAI official documentation, systematically explains how to control various aspects of video generation using cues.

This guide
is based on the "Sora 2 Prompting Guide" from the OpenAI Cookbook (released October 6, 2025).
Original authors: Robin Koenig (OpenAI), Joanne Shin (OpenAI).
The Chinese version was compiled by the SoratoAI community and localized based on practical experience.
Things you need to know before you begin
The prompts are a creative wish list, not a rigid contract.
Imagine you're giving a briefing to a photographer who's never seen a storyboard before. If you omit details, he'll improvise—and the result might deviate from your expectations. By specifying the effect the "shot" should achieve, you give the model better control over the frame and maintain consistency.

However, leaving room for imagination is equally important . Giving models more creative freedom can lead to unexpected surprises and wonderful interpretations. Both methods are effective:

Detailed prompts → Greater control and consistency
Concise prompts → More creative possibilities and diverse results
How to achieve this balance depends on your goals and desired outcomes.

Embrace diversity and prepare for iteration.
Just like with ChatGPT, using the same suggestion multiple times will produce different results —this is a feature, not a bug. Each generation is a fresh attempt, and sometimes the second or third version works better.

Even minor adjustments to the camera angle, lighting, or motion can significantly alter the outcome. You need to collaborate with the model: you provide the direction, and the model offers creative variations .

Important note
: This is not precise science—consider the following guidelines as practical advice, not strict rules. Adjustments should be made based on specific circumstances in practice.
API parameter settings
The prompts control the video content, but some attributes can only be set through API parameters and cannot be changed through text descriptions:

Parameters that must be set explicitly
parameter illustrate Optional values
model Model version sora-2orsora-2-pro
size Video resolution See the table below
seconds Video length 4、8、12(default is 4)
Supported resolutions
sora-2 model
1280x720 (720p in landscape mode)
720x1280 (720p portrait mode)
sora-2-pro model
1280x720 (720p in landscape mode)
720x1280 (720p portrait mode)
1024x1792 (Vertical High Definition)
1792x1024 (Landscape High Definition)
These parameters are the "container" of the video—resolution, duration, and quality will not change because of textual descriptions such as "make it longer." They must be explicitly set in the API call, and the cue words control everything else (subject, motion, lighting, style).
The impact of resolution on the generated effect
Video resolution directly affects visual fidelity and motion smoothness :

High resolution can generate details, textures, and lighting transitions more accurately.
Low resolution compresses visual information, often resulting in blurriness or imperfections.
Best practices for video length
The model follows instructions more reliably in shorter videos . For best results:

Try to generate short shots
If the project allows, editing two 4-second clips together might produce a better result than generating an 8-second clip directly.
Effective prompt word structure
Clear cues should describe the shot like a sketch on a storyboard:

Explain the framing - clarify the camera angle and composition.
Define depth of field - Specify focus and background blur level
Describe motion step by step - describe movement using executable beats
Set the lighting and tone - Define the light source, direction, and color scheme.
Use a few unique details to anchor the subject and keep it recognizable, while using a single, logical action to make it easier for the camera to follow.

Single lens vs. multiple lenses
Single-lens description
A clear lens unit includes:

One camera setup
A main action
A lighting scheme
Multi-camera sequence
If you need to cover consecutive scenes, you can describe multiple shots within a single cue word, but each shot description block should remain independent . This gives you flexibility:

Generate independent short film post-production editing
Or generate a continuous sequence for playback at once
Treat each shot as a creative unit.

Trade-offs in prompt word length
Short prompt ✨

Give models more creative freedom
You might receive an unexpected surprise.
Detailed prompts ⚙️

Limiting model creativity
I will try my best to follow the guidelines, but they are not always reliable.
Short prompt example
在一段90年代纪录片风格的采访中，一位瑞典老人坐在书房里说："我至今还记得我年轻的时候。"

Why is this prompt effective?

90年代纪录片风格- Set the video style, and the model will select the camera angle, lighting, and color tone accordingly.
一位瑞典老人坐在书房里- Briefly describe the subject and scene to give the model room to develop its own ideas.
说："我至今还记得我年轻的时候。"- Describe the dialogue; Sora is very likely to be able to reproduce it precisely.
Note : This prompt can reliably generate videos that meet the requirements, but it may not perfectly match your expectations because many details are not mentioned:

Specific time and weather
Clothing, Atmosphere
Character appearance and age
Camera angle, editing
Set design
Other details
Unless you describe these details, Sora will create them on its own.

Extremely detailed keyword prompts (movie-quality)
For complex, cinematic shots, standard structures can be transcended, and professional production terminology can be used to specify:

Appearance and format
Lens and Filter
Color palette/color swatches
Light direction
Texture
Diegetic sound effects within the scene
Shot sequence
Reason for shooting
This is similar to a director giving a briefing to the cinematography or VFX team. Detailed shots, filters, lighting, color grading, and motion cues help the model define a very specific aesthetic style.

Movie-quality prompts example
格式与外观
时长4秒；180°快门；数字拍摄模仿65毫米胶片对比度；细颗粒感；
高光部分有轻微光晕；无胶片抖动。

镜头与滤镜
32mm/50mm球面定焦镜头；1/4黑柔焦滤镜；
轻微旋转环形偏振镜以控制火车车窗反光。

调色/色板
高光：带有琥珀色调的清晨阳光
中间调：平衡中性色，阴影部分略带青色
暗部：柔和中性黑色，为保留薄雾感而轻微提亮

光线与氛围
自然阳光从摄影机左侧以低角度射入（早上7:30）
补光：轨道旁使用4x4英尺银色反光板
对面墙壁作为吸光
场景光源：站台上的钠灯逐渐变暗
氛围：轻柔薄雾；火车废气飘过光束

地点与构图
城市通勤站台，黎明时分
前景：黄色安全线，长凳上的咖啡杯
中景：等待的乘客在薄雾中形成剪影
背景：进站的火车正在刹车
避免出现任何标牌或公司品牌

服装/道具/群众演员
主要角色：30多岁旅行者，身穿海军蓝外套，单肩背包，手机随意拿在身侧
群众演员：穿暗色衣服的通勤者；一名推自行车的骑行者
道具：纸质咖啡杯，拉杆箱，LED出发信息牌（通用目的地）

音效
仅场景内音效：微弱铁轨摩擦声，火车刹车嘶嘶声，
远处模糊广播声（-20 LUFS），低沉环境嗡嗡声
脚步声和纸张沙沙声；无配乐或后期音效

优化分镜表（2个镜头/总时长4秒）

0.00–2.40 — "抵达漂移"（32mm镜头，肩扛式缓慢向左移动）
镜头滑过站台标牌边缘；浅焦揭示出旅行者在画面中央，正望着轨道远方。
晨光在镜头中绽放；火车头灯在薄雾中柔和闪耀。
目的：建立场景和基调，暗示期待感。

2.40–4.00 — "转身停顿"（50mm镜头，缓慢弧线推近）
切到更近的过肩弧线镜头，火车停稳；旅行者稍微转向镜头，
阳光勾勒出脸颊轮廓，手机屏幕反射光芒。眼睛向上瞥向某个看不见的东西。
目的：用最少动作创造聚焦于人物的瞬间。

摄影机备注（为何这样拍）
保持视线高度较低并靠近镜头轴线，营造亲密感
允许火车玻璃产生微小眩光，作为美学纹理
保留手持拍摄的微小不完美，增加真实感
不要让过曝眩光破坏剪影清晰度；保留皮肤高光平滑过渡

后期制作
叠加细颗粒感和轻微色度噪点增加真实感；
场景光源有克制的光晕；使用冷暖色调LUT营造清晨色调分离感
混音：优先处理火车和环境细节，而不是脚步声瞬态
封面帧：旅行者转身瞬间，金色轮廓光，进站火车在背景薄雾中柔焦

This level of detail is suitable for scenes that need to match the style of real cinematography (such as IMAX aerial shots, 35mm handheld shots, retro 16mm documentaries) or maintain strict continuity between multiple shots.

Use visual cues to guide style
Style is one of the most powerful levers for guiding a model toward the desired outcome . Describing overall aesthetics—for example:

"1970s film style"
"Epic, IMAX-scale scenes"
16mm black and white film
These descriptions set the visual tone for all other choices. Establishing a style early on allows the model to maintain that style throughout.

How style influences interpretation
The same details can produce drastically different effects depending on the style requirements:

Exquisite Hollywood drama
Short video shot with a handheld mobile phone
Retro advertisement with a strong grainy texture
Once the tone is set, then add specific details using camera work, movement, and lighting.

Clarity is paramount: Specificity trumps ambiguity.
Use verbs and nouns that point to visible results , and avoid vague descriptions:

Bad example ❌ Excellent example ✅
"A beautiful street" "The wet asphalt road, the zebra crossing, and the reflection of neon lights in the puddles."
"Character moves quickly" The cyclist pedaled three times, braked, and stopped in front of the pedestrian crossing.
"Cinematic feel" "2.0x anamorphic widescreen lens, shallow depth of field, volumetric lighting"
Camera orientation and composition
Camera orientation and composition shape the feel of the shot:

High-angle wide-angle lens - emphasizes space and environment
Eye-level close-up - Focusing on emotions
Depth of field adds another dimension:

Shallow depth of field - the subject stands out against a blurred background.
Deep depth of field - both foreground and background remain sharp.
Lighting can also strongly set the tone:

Soft and warm main light - creating a cozy atmosphere
A single hard light with cool-toned edges - pushing towards drama
Weak hints vs. strong hints examples
Bad example :

摄影机镜头：电影感

Excellent example :

摄影机镜头：广角镜头，低角度
景深：浅景深（主体清晰，背景模糊）
光线与色调：温暖逆光，带有柔和轮廓光

Examples of excellent composition instructions
Wide-angle lens, eye level
Wide-angle lens, following the charge from left to right
Aerial wide-angle lens, slightly downward angle
Medium close-up, slightly angled from behind.
Examples of excellent camera movement commands
Slowly tilting camera
Handheld news interview camera
Considerations for Role Consistency
When introducing characters, anticipate some unpredictability —minor changes in wording may alter the outcome:

Role Identity
posture
Scene Focus
Methods to maintain consistency :

Maintaining consistency in description across different shots
Repeating the same wording ensures consistency
Avoid mixing potentially conflicting features
Controlling actions and timing
Actions are often the most difficult part to master, so keep them simple .

One shot, one story principle
Each shot should only have:

A clear camera movement
A clear main action
Describe the action using rhythm.
Actions are best described using beats or counts —such as small steps, gestures, or pauses—so that there is a basis for timing.

Bad example ❌:

演员走过房间。

Excellent example ✅:

演员向窗户走了四步，停顿了一下，在最后一秒拉上了窗帘。

The second example makes the timing precise and feasible.

Consistency of light and color
Light, like movement and setting, collectively determines the mood of a picture .

The influence of light texture
The diffused light that permeates the image - calm and neutral.
A single, strong light source – creating a stark contrast and a sense of tension.
The key to editing coherence
When you want to edit multiple clips together, maintaining consistency in lighting logic is key to making the editing seamless.

Best practices for describing light
It is necessary to describe both the texture of light and the color anchors that enhance this texture .

Bad example ❌:

光线与色调：光线明亮的房间

Excellent example ✅:

光线与色调：柔和窗光，辅以温暖台灯补光，以及来自走廊的冷色边缘光
色调锚点：琥珀色、奶油色、胡桃棕

Specifying 3-5 colors helps maintain tonal stability across different lenses.

Gain more control with image input
To gain more precise control over the composition and style of a shot, image input can be used as a visual reference.

The role of image input
Elements that can be locked:

Character Design
clothing
Set decoration
Holistic Aesthetics
The model uses the image as the anchor point for the first frame , while the text prompts define what happens next.

How to use
In the POST /videos request, input_referenceinclude the image files as parameters.

Require :

The image must match the target video resolution (size).
Supported formats: image/jpeg, image/png,image/webp
Example Comparison
Input image (generated using GPT Image) Generate video (Sora 2)
Women's City Skyline The prompt reads: "She turned around, smiled, and then slowly walked out of the frame."
Purple Monster The cue message reads: "The refrigerator door opens. A cute, chubby purple monster walks out."
Experimental techniques
If you don't yet have visual references, OpenAI's image generation models are powerful tools for creating them. You can:

Rapidly generate environment and scene designs
Pass them as references into Sora
Test aesthetics and generate beautiful video starting points
Dialogue and sound effects
Dialogue Writing Guidelines
Dialogue must be described directly in the cue words. Place it in a separate block below the scene description so that the model can clearly distinguish between visual descriptions and spoken dialogue.

Key points for dialogue writing
Keep it simple and natural - avoid lengthy and complicated speeches.
Limit dialogue length - try to keep it to a few sentences so that the timing matches the video length.
Labeling Speakers - For multi-role scenarios, consistently label speakers and use turn-taking.
Consider duration matching :
A 4-second shot - typically contains 1-2 short lines of dialogue.
8-second clips - more can be supported
A lengthy and complex speech is unlikely to be well synchronized and may disrupt the rhythm.
Examples of prompts with dialogue
一个狭窄、没有窗户的房间，墙壁是陈旧灰烬的颜色。
天花板上悬挂着一个光秃秃的灯泡，灯光汇聚在中央那张伤痕累累的金属桌子上。
两把椅子隔桌相对。一边坐着警探，风衣搭在椅背上，眼神锐利而不眨。
他对面，嫌疑人懒散地靠着，烟雾慢悠悠地向天花板卷去。
寂静压迫着一切，只有头顶灯光的微弱嗡嗡声打破了沉默。

对白：

- 警探："你在撒谎。我能从你的沉默中听出来。"
- 嫌疑人："或许我只是懒得说话了。"
- 警探："不管怎样，今晚结束前你会开口的。"

Sound cues for silent shots
Even if the shot is silent, you can still use a subtle sound to suggest rhythm, for example:

The hissing of traffic in the distance
A crisp snapping sound
Think of it as a rhythm cues , not a complete audio track.

Example of background sound description
背景是意式浓缩咖啡机的嗡嗡声和人们的低语声。

Iterating using Remix features
The Remix feature is for fine-tuning , not for gambling.

Remix Best Practices
Make controlled, one-at-a-time modifications.
Clearly state the changes :
"The same lens, but with an 85mm lens."
"The same lighting, but new hues: cyan, sand, and rust."
Strategies for Approaching the Target
When the result is close to the ideal:

Fix it as a reference
Only describe the parts that need adjustment.
In this way, all the parts that have already worked can remain unchanged.

Handling of problematic shots
If a shot is always wrong:

Simplify - Fix the camera, simplify the action, and clear the background.
Verification - Once successful
Iteration - increasing complexity step by step.
Remix Example
Original video Remix video generation
Original Monster Video The prompt message is: "Change the monster's color to orange."
Original Monster Video The prompt reads: "Immediately afterwards, a second monster appeared."
Prompt word templates and examples
Standard prompt word structure
An effective writing style is to separate different types of information . This isn't a one-size-fits-all success formula, but it provides a clear framework and makes maintaining consistency easier.

Not every detail needs to be included – if something is not important to the shot, it can be omitted.

In fact, keeping certain elements open-ended encourages greater creativity in the model . The less restrictive you are on each visual choice, the more room the model has to interpret and surprise you with unexpected, often beautiful, variations.

Trade-offs in the level of detail in the description
Highly descriptive cues → More consistent, controllable results
Lighter cue words → Unlock diverse results that feel novel and imaginative
General template
[用通俗语言进行散文式的场景描述。描述角色、服装、布景、天气和其他细节。
尽可能详细地描述，以生成符合你构想的视频。]

摄影：
摄影机镜头：[构图和角度，例如：广角建立镜头，平视角度]
景深：[浅/深]
镜头/风格线索：[例如：变形镜头、手持]
情绪：[整体基调，例如：电影感的紧张，俏皮的悬疑，奢华的期待]

动作：

- [动作1：一个清晰、具体的节拍或手势]
- [动作2：片段内的另一个独特节拍]
- [动作3：另一个动作或台词]

对白：
[如果镜头有对白，在此处或作为动作列表的一部分添加简短自然的台词。
保持简短，以匹配视频长度。]

Complete Example
Example 1: Robot Studio Scene
风格：手绘2D/3D混合动画，具有柔和笔刷纹理、温暖钨丝灯光和
富有质感的定格动画感。美学风格唤起了2000年代中期的故事书动画——
舒适、不完美、充满机械魅力。微妙的水彩渲染和绘画般纹理；
色调上有冷暖平衡；电影感的运动模糊以增强动画真实感。

在一个杂乱的工作室里，架子上堆满了齿轮、螺栓和泛黄的蓝图。
中央，一个小小的圆形机器人坐在一张木凳上，它凹陷的身体上贴着
不匹配的金属板和旧漆层。它大大的发光眼睛闪烁着淡蓝色的光，
紧张地摆弄着一个嗡嗡作响的灯泡。空气中回荡着安静的机械嗡鸣声，
雨点敲打着窗户，背景中时钟在稳定地滴答作响。

摄影：
摄影机：中景特写，缓慢推进，悬挂的工具产生轻微的视差效果
镜头：35毫米虚拟镜头；浅景深以柔化背景的杂乱
光线：来自头顶场景光源的暖色主光；来自窗户的冷色溢光以形成对比
情绪：温柔、奇幻，带有一丝悬念

动作：

- 机器人敲了敲灯泡；火花噼啪作响
- 它吓得一哆嗦，灯泡掉了下来，眼睛睁得大大的
- 灯泡在慢动作中翻滚；它在最后一刻接住了它
- 一股蒸汽从它胸口喷出——既是松了口气，又带着自豪
- 机器人轻声说："差点丢了……但我接住了！"

背景音：
雨声，时钟滴答声，柔和的机械嗡鸣声，微弱的灯泡嘶嘶声。

Example 2: Romantic dance scene on the rooftop
风格：1970年代浪漫剧情片，用35毫米胶片拍摄，带有自然的镜头眩光、
柔焦和温暖的光晕。轻微的胶片抖动和手持微抖唤起了复古的亲密感。
温暖的柯达风格调色；灯泡上有轻微光晕；胶片颗粒感和柔和的暗角
以营造时代真实感。

在黄金时刻，一个砖砌公寓的屋顶变成了一个小舞台。
晾衣绳上挂着的白床单在风中摇曳，捕捉着最后一缕阳光。
一串串不匹配的仙女灯在头顶微弱地嗡嗡作响。
一个穿着飘逸红色丝绸连衣裙的年轻女子赤脚跳舞，
卷发在渐逝的光线中闪耀。她的舞伴——袖子卷起，吊带松垮——
在一旁拍手，笑容灿烂而毫无防备。下方，城市在汽车喇叭声、
地铁的震动和远处的笑声中嗡嗡作响。

摄影：
摄影机：中景广角镜头，从平视角度缓慢向前推进
镜头：40毫米球面镜头；浅焦以将这对情侣与天际线分离开
光线：金色的自然主光，辅以钨丝灯补光；仙女灯提供边缘光
情绪：怀旧、温柔、电影感

动作：

- 她旋转；裙摆飞扬，捕捉到阳光
- 女人（笑着说）："看？今晚连这座城市都在和我们共舞。"
- 他走上前，抓住她的手，将她带入阴影中
- 男人（微笑着说）："那只是因为你在领舞。"
- 床单飘过画面，短暂地遮住了天际线，然后再次分开

背景音：
仅自然环境音：微弱的风声、布料飘动的声音、街道噪音、模糊的音乐。
无额外配乐。

Troubleshooting
The results are too random?
Solution : Add descriptions for framing, depth of field, and light anchor points.

Is motion unreadable?
Solution : Converge to "one camera movement + one action"

The editing is disjointed?
Solution : Fixed light logic and color palette

Inconsistent roles?
Solution : Reuse the same set of identity descriptions and wording

Summary and Best Practices
Key points
API parameters first - model, size, and seconds must be explicitly set.
Simplicity vs. Detail - Balancing Control and Creative Space Based on Needs
One shot, one story - one camera movement + one main action
Visual anchors - replacing vague terms with concrete, visible descriptions.
Lighting consistency - Maintaining stable lighting logic across lenses
Iterative optimization - Fine-tune using Remix instead of rebuilding.
Recommended Workflow
Define your objective - determine the effect you want the shot to achieve.
Set parameters - Select appropriate model, size, and seconds.
Write your initial prompt - start with something simple, or use a template.
Generate and evaluate - View multiple variants and select the closest one.
Remix optimization - Targeted adjustments to the selected version
Editing and Integration - Integrating satisfactory clips into the project.
