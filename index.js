const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const User = require('./models/User.js');
const Place = require('./models/Place.js');
const Booking = require('./models/Booking.js');
const bcrypt = require('bcryptjs');
const jwt =  require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const imageDownloader = require('image-downloader');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config()

const port = process.env.PORT || 3000;


const bcryptSalt = bcrypt.genSaltSync(10);
const jwtSecret = process.env.JWT_SECRET;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/uploads' , express.static(__dirname+'/uploads'));
app.use(cors({
    credentials : true ,
    origin : ['http://localhost:5173', process.env.FRONTEND_URL],
}))

// origin : 'http://localhost:5173',
mongoose.connect(process.env.MONGO_URL);

console.log(process.env.MONGO_URL);
console.log(process.env.JWT_SECRET);

app.get('/', (req, res) => {
    res.send('API is running');
});

app.get('/api/test' , (req,res) => {
    res.json('test ok');
});

function getUserDataFromReq(req) {
    return new Promise((resolve, reject) => {
        const token = req.cookies.token; // Ensure this exists
        if (!token) return reject(new Error('Token not provided'));

        jwt.verify(token, jwtSecret, {}, (err, userData) => {
            if (err) return reject(err);
            resolve(userData);
        });
    });
}

app.post('/api/register', async (req,res) =>{
    const {name,email,password} = req.body ;
    try {
        const userDoc = await User.create({
            name ,
            email ,
            password : bcrypt.hashSync(password,bcryptSalt),
        });
    
        res.json(userDoc);
    } catch (error) {
        res.status(422).json({ error: 'Registration failed', details: error })
    }
    
})

app.post('/api/login' , async (req,res) => {
    const {email , password} = req.body ;
    const userDoc = await User.findOne({email})
    if(userDoc){
        const passOk = bcrypt.compareSync(password,userDoc.password)
        if(passOk){
            jwt.sign({
                email:userDoc.email , 
                id : userDoc._id , 
            }, jwtSecret , {} , (err,token) =>{
                if(err) throw err ;
                res.cookie('token', token, {
                    httpOnly: true, // Helps mitigate XSS
                    secure: process.env.NODE_ENV === 'production', // Only use HTTPS in production
                    sameSite: 'None', // Required for cross-origin cookies
                }
            ).json(userDoc);
            });
            
        }else{
            res.status(422).json('Incorrect password');
        }
    }else{
        res.status(404).json('User not found');
    }
})

app.get('/api/profile' , (req,res) =>{
    const {token} = req.cookies;
    if(token){
        jwt.verify(token,jwtSecret,{}, async (err,userData)=>{
            if(err){
                return res.status(401).json({ message: 'Unauthorized', details: err });
            }
            const {name,email,_id} = await User.findById(userData.id)
            res.json({name,email,_id});
        })
    }else{
        res.json(null);
    }

})

app.post('/api/logout', (req,res) => {
    res.cookie('token' , '').json(true);
})

app.post('/api/upload-by-link' , async (req,res) =>{
    const { link } = req.body;
    
    if (!link) {
        return res.status(400).json({ message: 'The link is required.' });
    }
    try {
        const newName = 'photo' + Date.now() + '.jpg';
        await imageDownloader.image({
            url: link,
            dest: __dirname + '/uploads/' + newName,
        });
        res.json(newName);
    } catch (error) {
        console.error('Error downloading image:', error);
        res.status(500).json({ message: 'Image download failed', error });
    }
})

const photosMiddleware = multer({ dest : 'uploads/'})
app.post('/api/upload',photosMiddleware.array('photos',100) , (req,res) => {
    const uploadedFiles = [];
    try {
        for (let i = 0; i < req.files.length; i++) {
            const { path, originalname } = req.files[i];
            const parts = originalname.split('.');
            const ext = parts[parts.length - 1];
            const newPath = path + '.' + ext;

            fs.renameSync(path, newPath);
            uploadedFiles.push(newPath.replace('uploads',''));
        }
        res.json(uploadedFiles);
    } catch (error) {
        console.error('Error during file upload:', error);
        res.status(500).json({ message: 'File upload failed', error });
    }
});

app.post('/api/places', async (req, res) => {
    // const { token } = req.cookies;
    const { title, address, addedPhotos, description, perks, extraInfo, checkIn, checkOut, maxGuests, price } = req.body;

    try {
        const userData = await getUserDataFromReq(req);
        await Place.create({
            owner: userData.id,
            title,
            address,
            photos: addedPhotos,
            description,
            perks,
            extraInfo,
            checkIn,
            checkOut,
            maxGuests,
            price
        });
        res.status(201).json({ message: 'Place created successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to create place', details: err });
    }
});

app.get('/api/user-places', async (req, res) => {
    const { token } = req.cookies;
    if (token) {
        try {
            const userData = await getUserDataFromReq(req);
            const places = await Place.find({ owner: userData.id });
            res.json(places);
        } catch (err) {
            res.status(500).json({ message: 'Error fetching user places', details: err });
        }
    } else {
        res.json(null);
    }
});


app.get('/api/places/:id', async (req,res) => {
    const {id} = req.params ;
    const place = await Place.findById(id);
    if (place) {
        res.json(place);
    } else {
        res.status(404).json({ message: 'Place not found' });
    }
});

app.put('/api/places',async (req,res) => {
    // const { token } = req.cookies;
    const { id, title, address, addedPhotos, description, perks, extraInfo, checkIn, checkOut, maxGuests, price } = req.body;

    try {
        const userData = await getUserDataFromReq(req);
        const placeDoc = await Place.findById(id);
        if (userData.id === placeDoc.owner.toString()) {
            placeDoc.set({
                title,
                address,
                photos: addedPhotos,
                description,
                perks,
                extraInfo,
                checkIn,
                checkOut,
                maxGuests,
                price
            });
            await placeDoc.save();
            res.json('Place updated successfully');
        } else {
            res.status(403).json({ message: 'Unauthorized' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Error updating place', details: err });
    }
});

app.get('/api/places',async (req,res)=> {
    res.json(await Place.find())
});

app.post('/api/booking' , async (req,res) => {
    try {
        const userData = await getUserDataFromReq(req);
        const { place, checkIn, checkOut, numberOfGuests, name, phone, price } = req.body;
        const booking = await Booking.create({
            place,
            checkIn,
            checkOut,
            numberOfGuests,
            name,
            phone,
            price,
            user: userData.id,
        });
        res.json(booking);
    } catch (err) {
        res.status(500).json({ message: 'Booking failed', details: err });
    }
});



app.get('/api/bookings' , async (req,res) => {
    try {
        const userData = await getUserDataFromReq(req);
        const bookings = await Booking.find({ user: userData.id }).populate('place');
        res.json(bookings);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching bookings', details: err });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});