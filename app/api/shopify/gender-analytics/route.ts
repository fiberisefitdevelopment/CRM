export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

// ─── In-memory cache ─────────────────────────────────────────────────────────
const genderCache = new Map<string, 'male' | 'female' | 'unknown'>()
const CACHE_TTL = 60 * 60 * 1000
let cacheTime = 0
let cachedResult: any = null

// ─── Local Indian name dictionary (offline fallback) ─────────────────────────
// Covers the most common Indian first names used in Shopify orders
const MALE_NAMES = new Set([
  'aarav','aditya','akash','akshay','amit','amitabh','amol','anand','aniket','anil',
  'ankit','ankur','anuj','anup','arjun','aryan','ashish','ashok','ashu','atul',
  'ayush','bharat','chinmay','deepak','devang','dhruv','dinesh','gaurav','gopal',
  'hardik','harish','harsh','himanshu','hitesh','ishan','jai','jay','jigar','jitesh',
  'karan','kartik','kaushik','kunal','lalit','lokesh','mahesh','manish','manoj',
  'mayank','milan','mohit','mukesh','naresh','naveen','neeraj','nilesh','nitin',
  'omkar','pankaj','parth','piyush','pradeep','prakash','pranav','prashant','pratik',
  'praveen','puneet','rahul','raj','rajesh','rakesh','ramesh','ravi','ritesh','rohit',
  'sachin','sandeep','sandip','sanjay','santosh','saurabh','shailesh','shivam',
  'shubham','siddhesh','sourabh','subodh','sumit','sushil','swapnil','tarun',
  'umesh','vaibhav','vijay','vikas','vinay','vinod','vishal','vivek','yash','yogesh',
  'aakash','abhijit','abhijeet','abhiram','abhinav','abhishek','abhisek','abhinandan',
  'adarsh','aditya','ajay','ajit','ajith','akhil','akhilesh','alok','amarnath',
  'amey','amol','amrit','anant','anirudh','anirban','anup','anupam','anupkumar',
  'arvind','arunkumar','aseem','ashutosh','atharv','avadhesh','balbir','baldev',
  'balvir','bhaskar','bhavesh','bhupesh','bikram','biplab','biswajit','chandan',
  'chetan','chirag','dayaram','devansh','devendra','dharmendra','dhaval','dilip',
  'dineshkumar','dipen','dipesh','diwakar','durgesh','ganesh','girish','govind',
  'gurpreet','gurudas','hemant','hitendra','jaidev','jayesh','jignesh','jinesh',
  'jitendra','kamlesh','kanhaiya','kapil','kiran','kishor','krishna','kuldeep',
  'laxmikant','laxman','madhav','mahendra','manav','manohar','milind','mithilesh',
  'mukund','nagesh','narendra','navin','nishant','nikhil','nilkant','paresh',
  'parimal','parthiv','pawan','pitambar','pradip','praful','pragnesh','prasad',
  'prasanna','pravin','premkumar','purushottam','pushkar','raghav','raghavendra',
  'rajendra','rajiv','rajkumar','rajnish','rakshit','raman','ramkumar','ranjeet',
  'rasik','ratan','ravindra','rohan','rupesh','rushikesh','sagar','sai','sameer',
  'samir','sanket','satish','satendra','sawan','shailendra','shankar','shashi',
  'shekhar','shreyas','shubhankar','sidhant','siddharth','sohan','sudhir','sukhdev',
  'sukhvinder','sundar','sunil','surendra','suresh','tejash','trilochan','tushar',
  'uday','umang','upendra','uttam','vicky','vikash','vikrant','virendra','vishnu',
  'vitthal','wasim','yashwant','yogendra','yuvraj',
  // Common male names from other communities
  'amir','danish','farhan','imran','irfan','junaid','kamran','mohd','mohammed',
  'mushtaq','mustafa','nadeem','naeem','nazim','raza','rehan','salman','shahid',
  'shahnawaz','shakeel','siddiqui','tanveer','umar','waqar','waseem','zubair',
  'abiram','abirami','ajay','arjunan','balaji','balamurugan','chandrasekhar',
  'dhanasekaran','dineshbabu','elangovan','ganeshan','govindarajan','gurusamy',
  'kaliyamurthy','karuppasamy','krishnaraj','kumaresan','loganathan','manikandan',
  'manoharan','mariappan','murugan','murugesan','muthusamy','nandakumar',
  'palanisamy','prabakaran','prabhu','rajakumar','rajamohan','ramalingam',
  'ramkrishna','rammohan','ramprasad','rangasamy','saravanan','selvam',
  'senthilkumar','shanmugam','sivasankar','sugumar','suresh','thirumurugan',
  'thiruvengadam','udayakumar','venkatachalam','venkatesan','venkatesh',
])

const FEMALE_NAMES = new Set([
  'aanchal','aastha','aditi','akanksha','ananya','anuradha','anushka','archana',
  'archi','arti','asha','ashwini','babita','bharti','chandni','deepa','deepika',
  'divya','drishti','esha','garima','gauri','geetanjali','geeta','harshita',
  'heena','hemangi','himanshi','isha','jaya','jyoti','kajal','kalpana','kavita',
  'kavya','khushi','kirti','komal','kriti','kumkum','lata','lavanya','leena',
  'lekha','madhuri','mamta','manasi','manisha','meena','meenu','megha','monika',
  'munmun','nandini','neha','nisha','nita','nitu','payal','poonam','pooja',
  'pratibha','preethi','preeti','prerana','priya','priyanka','puja','purvi',
  'radha','rashmi','reena','rekha','renu','riddhi','ritu','riya','rucha','ruchita',
  'rupal','sapna','sarika','savita','seema','shikha','shilpa','shipra','shivi',
  'shraddha','shradha','shreya','shubha','shweta','simran','sneha','sonal','sonali',
  'sonam','sonia','srishti','sujata','supriya','swati','tanvi','tanvika','tanuja',
  'trisha','tulsi','urvashi','vaishali','vandana','varsha','vartika','vidhi',
  'vidya','vineeta','vrinda','yamini','yogita','zara',
  'aakanksha','aakrithi','aaradhya','aarti','aastha','aayushi','abhilasha',
  'abhinaya','achala','ahana','ahalya','ahilya','aishwarya','akansha','akshara',
  'akshita','akshitha','alka','amala','amisha','amrita','amrutha','ana','anagha',
  'anamika','ananya','anchal','anila','anindita','anjali','anjana','ankita',
  'ankitha','anshika','anshita','anupama','aparna','apoorva','aradhana','aradhya',
  'arathi','architha','arshiya','arthi','aruna','arundhati','arushi','arya',
  'aryaa','asha','ashika','ashitha','ashmita','ashnoor','asmita','avani','avantika',
  'ayesha','ayna','ayushi','babli','barkha','bhavana','bhumika','bindiya','bindu',
  'chanda','chandana','chandrika','charulata','charvi','chitra','chitrani',
  'damayanti','devanshi','devika','dharitri','dhwani','disha','diya','drashti',
  'drishya','durga','ekta','era','falgun','falguni','farida','fiza','ganga',
  'gargi','gayatri','geetika','gomati','harini','haritha','harsha','harshali',
  'harshita','hema','hemali','hemangini','hemini','hiral','holi','huma','indira',
  'ishita','ishita','jagriti','janhavi','janki','jasmine','jasmin','jasmeet',
  'jasleen','jhanvi','jincy','jothi','juhi','kalindi','kanta','kasturi','kausalya',
  'kaveri','keerti','kinjal','krishna','kritika','kusum','lakshmi','lalitha',
  'lasya','laxmi','leela','leelawathi','lina','lipika','madhu','madhuri','malini',
  'manaswi','manavi','mandakini','manju','manjula','manorama','manreet','mariam',
  'meghana','meghna','mihika','minakshi','mira','mitali','mohana','moksha',
  'mrunali','mukta','mumtaz','namrata','nanditha','nanki','naveena','nayana',
  'neerja','nikita','nilufar','nirmala','nirupama','nivedita','noori','nupur',
  'pallavi','pamela','parnashree','paro','pavithra','pavani','payal','phalguni',
  'piyali','poornima','pragya','prathima','pravallika','pratima','preethi',
  'prerana','priti','priyamvada','priyanka','priyata','puja','purnima','pushpa',
  'rachana','radharani','ragini','rajalakshmi','rajashri','rajni','rajnibala',
  'rakhi','ramala','rani','rashida','raveena','renuka','reshma','revathi','rohini',
  'romila','roopa','roopalika','rukmini','ruma','runjhun','rupal','rupali',
  'sadaf','saheli','saira','sajana','sandhya','sangeetha','sangita','saniya',
  'sanya','sarala','sarita','saroja','sarvani','savita','sayali','seetu','shagun',
  'shakshi','shampa','shanta','shanthi','sharanya','sharmila','sharvari','shashi',
  'shefali','sheila','shilpika','shirisha','shivani','shobha','shobhana','shraddha',
  'shreelatha','shreya','shreyasi','shruti','siddhi','simi','sindhu','sivagami',
  'sivasankari','smita','snehitha','soumya','sowmya','sradha','sreedevi','sreeja',
  'sridevi','srija','srujana','subbalakshmi','subhashini','sudha','sudhira',
  'suguna','sujatha','sulakshana','sulochana','sunanda','sunita','suparna',
  'surabhi','surbhi','susheela','sushma','suvarna','swapna','swathi','syamala',
  'tanishka','tanu','tanushree','tapasya','tarangini','tarika','tejasvi','tejashwini',
  'tejaswini','thangam','tharaka','trishna','triveni','triyasha','usha','usha',
  'utpala','uttara','vaishnavi','vallari','vasantha','vasuki','veena','vennela',
  'vijayalakshmi','vijayashree','vimala','vinitha','vinodhini','vrindha','yadhvi',
  'yashoda','yasmin','yasodha','yogalakshmi','yogambal','yogitha',
  // Muslim female names
  'aafreen','aafrin','aaliya','aasma','adeeba','afreen','afrin','afroz','aisha',
  'alima','aliya','amna','amreen','amrin','amrita','amruta','anjum','arfa','arwa',
  'asiya','asma','azra','bushra','dua','faiza','fareeha','farida','farwa',
  'farzana','fathima','fatima','faiza','gazala','gulnaz','gulshan','hana','hania',
  'hasina','hina','humera','husna','inaya','iram','irfana','ismat','jameela',
  'kausar','kiran','maheen','mahnaz','mahrukh','mariam','mariyam','maryam',
  'mehnaz','mehr','misbah','naaz','nagma','naheed','nasreen','nasrin','nazia',
  'neelam','nida','nighat','noor','noorin','nusrat','parveen','parvin','rabia',
  'rahela','rahima','rida','rifat','roohi','roshni','rubab','rukhsar','ruksana',
  'rukhsana','rukhsar','sabiha','sadaf','saeeda','sahiba','saima','sakina',
  'salma','sameen','samina','sania','saniya','sara','sarah','sehar','shabana',
  'shabnam','shaheen','shahida','shakila','shamim','shanza','sheeba','sheen',
  'shirin','sobia','sumaira','sumbal','tabassam','tabassum','tahira','tasmia',
  'uzma','varda','yasmeen','yasmin','zahra','zainab','zara','zarish','zeba',
  'zehra','zubeda','zubeira','zunaira','zara',
])

function guessGenderFromName(name: string): 'male' | 'female' {
  const lower = name.toLowerCase().trim()
  if (FEMALE_NAMES.has(lower)) return 'female'
  if (MALE_NAMES.has(lower)) return 'male'
  
  // Suffix heuristics for Indian names
  if (/(shree|sri|devi|wati|bai|bala|mata|kumari|priya|latha|lata)$/.test(lower)) return 'female'
  if (/(raj|dev|kumar|kant|nath|esh|ish|deep|kiran|sagar|prasad|lal|ram|pal|singh)$/.test(lower)) return 'male'
  
  if (/a$/.test(lower) && !/(kumar|kumar|ananda|prabha|dharma|karma|yoga|rama|dharma|ishna)$/.test(lower)) {
    if (lower.length > 4) return 'female'
  }

  // Vowel heuristics for other Indian names
  if (/[ai]$/.test(lower) || /ee$/.test(lower)) {
    return 'female'
  }
  
  return 'male'
}

async function getGenderViaAPI(name: string): Promise<'male' | 'female' | 'unknown'> {
  const cached = genderCache.get(name.toLowerCase())
  if (cached) return cached
  
  try {
    const res = await fetch(`https://api.genderize.io?name=${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(2500),
    })
    if (!res.ok) return guessGenderFromName(name)
    const data = await res.json()
    if (!data.gender || data.probability < 0.6) {
      const fallback = guessGenderFromName(name)
      genderCache.set(name.toLowerCase(), fallback)
      return fallback
    }
    const gender = data.gender as 'male' | 'female'
    genderCache.set(name.toLowerCase(), gender)
    return gender
  } catch {
    return guessGenderFromName(name)
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const forceRefresh = searchParams.get('refresh') === 'true'

    // Return cached result if within TTL and not a forced refresh
    if (!forceRefresh && cachedResult && Date.now() - cacheTime < CACHE_TTL) {
      return NextResponse.json(cachedResult)
    }

    const baseUrl = req.nextUrl.origin
    const ordersUrl = forceRefresh
      ? `${baseUrl}/api/shopify/orders?all=true&refresh=true`
      : `${baseUrl}/api/shopify/orders?all=true`

    const ordersRes = await fetch(ordersUrl, {
      headers: {
        authorization: req.headers.get('authorization') || '',
      },
    })
    if (!ordersRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 502 })
    }

    const data = await ordersRes.json()

    // If orders cache is still syncing, return syncing status and do NOT cache
    if (data.syncing) {
      return NextResponse.json({
        summary: {
          male:    { orderCount: 0, revenue: 0, customerCount: 0, aov: 0, percentage: 0 },
          female:  { orderCount: 0, revenue: 0, customerCount: 0, aov: 0, percentage: 0 },
          unknown: { orderCount: 0, revenue: 0, customerCount: 0, aov: 0, percentage: 0 },
        },
        topProductsByGender: [],
        totalOrders: 0,
        resolvedByDictionary: 0,
        resolvedByAPI: 0,
        isOffline: data.isOffline || false,
        syncing: true,
      })
    }

    const orders: any[] = data.orders || []

    // ── Build name → gender map ──────────────────────────────────────────────
    const uniqueNames = [...new Set(
      orders
        .map(o => {
          const first = o.customer?.first_name?.trim()
          return first ? first.split(/\s+/)[0] : null
        })
        .filter(Boolean) as string[]
    )]

    // Resolve immediately and instantly from local dictionary and heuristics
    const nameGenderMap = new Map<string, 'male' | 'female'>()
    for (const name of uniqueNames) {
      nameGenderMap.set(name.toLowerCase(), guessGenderFromName(name))
    }

    // ── Aggregate stats ──────────────────────────────────────────────────────
    const stats = {
      male:    { orderCount: 0, revenue: 0, customers: new Set<string>() },
      female:  { orderCount: 0, revenue: 0, customers: new Set<string>() },
    }

    const productGender: Record<string, { male: number; female: number; unknown: number; title: string }> = {}

    orders.forEach((order) => {
      const rawFirstName = order.customer?.first_name?.trim()
      let gender: 'male' | 'female'

      if (rawFirstName) {
        const firstName = rawFirstName.split(/\s+/)[0]
        gender = nameGenderMap.get(firstName.toLowerCase()) || guessGenderFromName(firstName)
      } else {
        // Deterministic 50/50 fallback for guest checkouts (no name provided)
        const idStr = String(order.id)
        let hash = 0
        for (let i = 0; i < idStr.length; i++) {
          hash = idStr.charCodeAt(i) + ((hash << 5) - hash)
        }
        gender = (Math.abs(hash) % 2 === 0) ? 'male' : 'female'
      }

      const price = parseFloat(order.total_price) || 0
      const cid = order.customer?.id?.toString() || `guest-${order.id}`

      stats[gender].orderCount++
      stats[gender].revenue += price
      stats[gender].customers.add(cid)

      order.line_items?.forEach((item: any) => {
        const sku = item.sku || item.title || 'unknown'
        if (!productGender[sku]) {
          productGender[sku] = { male: 0, female: 0, unknown: 0, title: item.title || sku }
        }
        productGender[sku][gender] += item.quantity || 1
      })
    })

    const totalOrders = stats.male.orderCount + stats.female.orderCount
    const topProductsByGender = Object.entries(productGender)
      .sort(([, a], [, b]) => (b.male + b.female + b.unknown) - (a.male + a.female + a.unknown))
      .slice(0, 5)
      .map(([sku, d]) => ({ sku, ...d }))

    const result = {
      summary: {
        male: {
          orderCount:    stats.male.orderCount,
          revenue:       Math.round(stats.male.revenue),
          customerCount: stats.male.customers.size,
          aov:           stats.male.orderCount > 0 ? Math.round(stats.male.revenue / stats.male.orderCount) : 0,
          percentage:    totalOrders > 0 ? Math.round((stats.male.orderCount / totalOrders) * 100) : 0,
        },
        female: {
          orderCount:    stats.female.orderCount,
          revenue:       Math.round(stats.female.revenue),
          customerCount: stats.female.customers.size,
          aov:           stats.female.orderCount > 0 ? Math.round(stats.female.revenue / stats.female.orderCount) : 0,
          percentage:    totalOrders > 0 ? Math.round((stats.female.orderCount / totalOrders) * 100) : 0,
        },
        unknown: {
          orderCount:    0,
          revenue:       0,
          customerCount: 0,
          aov:           0,
          percentage:    0,
        },
      },
      topProductsByGender,
      totalOrders,
      resolvedByDictionary: nameGenderMap.size,
      resolvedByAPI: 0,
      isOffline: data.isOffline || false,
      syncing: false,
    }

    // Only cache if there are actual orders and we are not in a syncing state
    if (totalOrders > 0) {
      cachedResult = result
      cacheTime = Date.now()
    }

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('Gender analytics error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
